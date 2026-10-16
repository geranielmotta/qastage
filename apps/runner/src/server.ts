import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import type { Logger, RunResult } from "@qastage/core-contract";
import { createRegistry } from "./bootstrap";
import { CONFIG_FILE, loadProjectConfig, resolveEnv } from "./config";
import { loadDotEnv } from "./env";
import { createProject, featureFile, getProject, listFeatures, listProjects, type NewProject } from "./projects";
import { listReports } from "@qastage/reports";
import { executeRun, workspaceRoot, type RunRequest } from "./execute";

/**
 * API HTTP do runner, consumida pelo shell. O shell nunca roda Playwright:
 * ele pede a execução aqui e acompanha o resultado por polling.
 *
 *   GET  /api/projects                     projetos (dashboard): ambientes, testes, últimas execuções
 *   POST /api/projects                     cria projetos/<id>/ com a config mínima
 *   GET  /api/projects/:id                 config resolvida do projeto (ambientes, padrões por plugin)
 *   GET  /api/projects/:id/features        .feature do projeto, por plugin
 *   GET|PUT /api/projects/:id/file?path=   lê/grava um .feature do projeto
 *   GET  /api/plugins          manifestos (o shell carrega os remotes a partir daqui)
 *   POST /api/runs             dispara uma execução → { id }
 *   GET  /api/runs/:id         estado, logs e resultado
 *   GET  /api/files?path=...   serve um artefato (print, mapa...) de dentro do projeto
 *   GET  /artifacts/...        pasta de artefatos como site estático (report.html e seus links relativos)
 *   *    /api/plugins/:nome/*  rotas contribuídas pelo próprio plugin (RunnerPlugin.routes); ?project=<id>
 */

interface RunRecord {
  id: string;
  request: RunRequest;
  state: "running" | "done";
  logs: Array<{ level: "info" | "warn" | "error"; msg: string }>;
  result?: RunResult;
  /** URL do report.html, relativa ao runner (ex.: /artifacts/ui-testing/123/report.html). */
  reportUrl?: string;
}

const PORT = Number(process.env.QASTAGE_PORT ?? 4000);
// Caminhos relativos (artefatos, --maps) valem a partir da raiz do monorepo,
// mesmo quando o servidor sobe de dentro de apps/runner (turbo dev).
process.chdir(workspaceRoot());
loadDotEnv();
/** Só servimos arquivos de dentro do projeto (artefatos, mapas). */
const ROOT = process.cwd();

const registry = createRegistry();
const runs = new Map<string, RunRecord>();

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".feature": "text/plain; charset=utf-8",
  ".webm": "video/webm",
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".zip": "application/zip",
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

/** Serve um arquivo só se estiver dentro de `base`. */
function sendFile(res: ServerResponse, path: string, base: string): void {
  if (!path.startsWith(base + sep) || !existsSync(path) || !statSync(path).isFile()) {
    return json(res, 404, { error: "Arquivo não encontrado" });
  }
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(res);
}

function startRun(request: RunRequest): RunRecord {
  const record: RunRecord = { id: randomUUID(), request, state: "running", logs: [] };
  const log = (level: "info" | "warn" | "error") => (msg: string) => {
    record.logs.push({ level, msg });
    console.log(`[${record.id.slice(0, 8)}] [${level}] ${msg}`);
  };
  const logger: Logger = { info: log("info"), warn: log("warn"), error: log("error") };

  runs.set(record.id, record);
  executeRun(registry, request, logger)
    .then(({ result, reportHtml }) => {
      record.result = result;
      if (reportHtml) record.reportUrl = "/" + relative(ROOT, reportHtml).split(sep).join("/");
    })
    .catch((e: Error) => {
      const agora = new Date().toISOString();
      record.result = { status: "error", error: e.message, artifacts: [], startedAt: agora, finishedAt: agora };
    })
    .finally(() => (record.state = "done"));
  return record;
}

function validRunRequest(body: unknown): RunRequest {
  const b = body as Partial<RunRequest>;
  if (!b || typeof b.plugin !== "string") throw new Error("Campo obrigatório: plugin");
  const e = b.env ?? {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    plugin: b.plugin,
    ...(typeof b.project === "string" && b.project ? { project: b.project } : {}),
    env: { name: str(e.name), baseUrl: str(e.baseUrl), apiUrl: str(e.apiUrl), authUrl: str(e.authUrl) },
    featureText: typeof b.featureText === "string" ? b.featureText : undefined,
    // Arquivo em disco só de dentro de um projeto (features/...); fora disso, use featureText.
    featurePath:
      typeof b.featurePath === "string" && b.featurePath
        ? typeof b.project === "string" && b.project
          ? (featureFile(getProject(b.project), b.featurePath), b.featurePath)
          : (() => {
              throw new Error("featurePath exige project");
            })()
        : undefined,
    params: b.params ?? {},
  };
}

const server = createServer(async (req, res) => {
  // Dev: shell e remotes rodam em outras portas.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();

  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/api/projects") {
      if (req.method === "POST") {
        const p = createProject((await readBody(req)) as NewProject);
        return json(res, 201, { id: p.id, name: p.name });
      }
      if (req.method === "GET") {
        const artifacts = join(ROOT, "artifacts");
        return json(
          res,
          200,
          listProjects().map((p) => {
            const base = { id: p.id, name: p.name, dir: relative(ROOT, p.dir) || "." };
            if (p.error) return { ...base, error: p.error };
            const features = listFeatures(p);
            const porPlugin: Record<string, number> = {};
            for (const f of features) porPlugin[f.plugin] = (porPlugin[f.plugin] ?? 0) + f.scenarios;
            const runs = listReports(artifacts, 5, p.id);
            return {
              ...base,
              padrao: p.config!.padrao ?? Object.keys(p.config!.ambientes)[0],
              ambientes: Object.keys(p.config!.ambientes).map((n) => resolveEnv(p.config, n)),
              cenarios: porPlugin,
              arquivos: features.length,
              ultimas: runs.map((r) => ({ id: r.id, plugin: r.plugin, status: r.status, startedAt: r.startedAt, env: r.env.name, counts: r.counts })),
            };
          }),
        );
      }
    }

    const mp = url.pathname.match(/^\/api\/projects\/([\w-]+)(\/features|\/file)?$/);
    if (mp) {
      const p = getProject(mp[1]!);
      if (!mp[2] && req.method === "GET") {
        return json(res, 200, {
          id: p.id,
          name: p.name,
          padrao: p.config!.padrao ?? Object.keys(p.config!.ambientes)[0],
          ambientes: Object.keys(p.config!.ambientes).map((n) => resolveEnv(p.config, n)),
          plugins: p.config!.plugins ?? {},
        });
      }
      if (mp[2] === "/features" && req.method === "GET") return json(res, 200, listFeatures(p));
      if (mp[2] === "/file") {
        const file = featureFile(p, url.searchParams.get("path") ?? "");
        if (req.method === "GET") {
          if (!existsSync(file)) return json(res, 404, { error: "Arquivo não encontrado" });
          return json(res, 200, { path: url.searchParams.get("path"), text: readFileSync(file, "utf8") });
        }
        if (req.method === "PUT") {
          const { text } = (await readBody(req)) as { text?: string };
          if (typeof text !== "string") throw new Error("Campo obrigatório: text");
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, text, "utf8");
          return json(res, 200, { ok: true });
        }
      }
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      // Ambientes já resolvidos (o shell não reimplementa a regra) + padrões por plugin.
      const cfg = loadProjectConfig();
      if (!cfg) return json(res, 404, { error: `Sem ${CONFIG_FILE} na raiz do projeto` });
      return json(res, 200, {
        projeto: cfg.projeto,
        padrao: cfg.padrao ?? Object.keys(cfg.ambientes)[0],
        ambientes: Object.keys(cfg.ambientes).map((n) => resolveEnv(cfg, n)),
        plugins: cfg.plugins ?? {},
      });
    }

    if (req.method === "GET" && url.pathname === "/api/plugins") {
      return json(res, 200, registry.list().map((p) => p.manifest));
    }

    if (req.method === "POST" && url.pathname === "/api/runs") {
      const request = validRunRequest(await readBody(req));
      registry.get(request.plugin); // 404 cedo se o plugin não existe
      if (request.project) getProject(request.project); // idem para o projeto
      return json(res, 202, { id: startRun(request).id });
    }

    const m = url.pathname.match(/^\/api\/runs\/([\w-]+)$/);
    if (req.method === "GET" && m) {
      const record = runs.get(m[1]!);
      return record ? json(res, 200, record) : json(res, 404, { error: "Execução não encontrada" });
    }

    if (req.method === "GET" && url.pathname === "/api/files") {
      return sendFile(res, resolve(url.searchParams.get("path") ?? ""), ROOT);
    }

    if (req.method === "GET" && url.pathname.startsWith("/artifacts/")) {
      const artifacts = join(ROOT, "artifacts");
      return sendFile(res, resolve(artifacts, "." + decodeURIComponent(url.pathname.slice("/artifacts".length))), artifacts);
    }

    const rp = url.pathname.match(/^\/api\/plugins\/([\w-]+)(\/.*)$/);
    if (rp) {
      const plugin = registry.get(rp[1]!);
      const rota = plugin.routes?.find((r) => r.method === req.method && r.path === rp[2]);
      if (rota) {
        const body = req.method === "GET" ? undefined : await readBody(req);
        const pid = url.searchParams.get("project");
        const proj = pid ? getProject(pid) : undefined;
        return json(
          res,
          200,
          await rota.handle({
            query: Object.fromEntries(url.searchParams),
            body,
            ...(proj ? { project: { id: proj.id, name: proj.name, dir: proj.dir } } : {}),
          }),
        );
      }
    }

    json(res, 404, { error: "Rota não encontrada" });
  } catch (e) {
    const msg = (e as Error).message;
    json(res, /^(Plugin|Projeto ".*") não encontrado/.test(msg) ? 404 : 400, { error: msg });
  }
});

server.listen(PORT, () => console.log(`QAStage runner em http://localhost:${PORT}`));
