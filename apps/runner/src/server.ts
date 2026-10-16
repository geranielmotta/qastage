import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import type { Logger, RunResult } from "@qastage/core-contract";
import { listReports } from "@qastage/reports";
import { AcessoNegado, ehAdmin, exigirAdmin, exigirProjeto, podeVerProjeto, projetoDoArquivo } from "./auth/access";
import {
  abrirSessao,
  bloqueado,
  cookieApagado,
  cookieDeSessao,
  fecharSessao,
  fecharSessoesDe,
  limparFalhas,
  registrarFalha,
  tokenDaRequisicao,
  usuarioDaRequisicao,
} from "./auth/sessions";
import {
  alterarUsuario,
  buscarPorEmail,
  confereSenha,
  criarUsuario,
  listarUsuarios,
  publico,
  senhaTemporaria,
  type AlteracaoUsuario,
  type Usuario,
} from "./auth/users";
import { createRegistry } from "./bootstrap";
import { CONFIG_FILE, loadProjectConfig, resolveEnv } from "./config";
import { loadDotEnv } from "./env";
import { executeRun, workspaceRoot, type RunRequest } from "./execute";
import { createProject, featureFile, getProject, listFeatures, listProjects, type NewProject } from "./projects";

/**
 * API HTTP do runner, consumida pelo shell. O shell nunca roda Playwright:
 * ele pede a execução aqui e acompanha o resultado por polling.
 *
 * Toda rota (exceto as de login) exige sessão. Admin vê tudo; QA só os
 * projetos atribuídos a ele — a regra vale aqui, não só na tela.
 *
 *   POST /api/auth/login | logout          sessão em cookie HttpOnly
 *   GET  /api/auth/me                      usuário da sessão (ou { setup: true } sem nenhum usuário)
 *   POST /api/auth/setup                   cria o primeiro admin (só com zero usuários)
 *   POST /api/auth/senha                   troca a própria senha
 *   GET|POST /api/admin/usuarios           [admin] lista / cria usuário (com senha temporária)
 *   PATCH /api/admin/usuarios/:id          [admin] nome, papel, ativo, projetos, redefinir senha
 *   GET  /api/projects                     projetos visíveis (dashboard)
 *   POST /api/projects                     [admin] cria projetos/<id>/
 *   GET  /api/projects/:id                 config resolvida do projeto
 *   GET  /api/projects/:id/features        .feature do projeto, por plugin
 *   GET|PUT /api/projects/:id/file?path=   lê/grava um .feature do projeto
 *   GET  /api/plugins                      manifestos (o shell carrega os remotes a partir daqui)
 *   POST /api/runs | GET /api/runs/:id     dispara e acompanha execuções
 *   GET  /api/files?path= | /artifacts/... arquivos de execução (só de projetos visíveis)
 *   *    /api/plugins/:nome/*              rotas do plugin; ?project=<id> (obrigatório para QA)
 */

interface RunRecord {
  id: string;
  request: RunRequest;
  state: "running" | "done";
  logs: Array<{ level: "info" | "warn" | "error"; msg: string }>;
  result?: RunResult;
  /** URL do report.html, relativa ao runner (ex.: /artifacts/portal/ui-testing/123/report.html). */
  reportUrl?: string;
}

const PORT = Number(process.env.QASTAGE_PORT ?? 4000);
// Caminhos relativos (artefatos, --maps) valem a partir da raiz do monorepo,
// mesmo quando o servidor sobe de dentro de apps/runner (turbo dev).
process.chdir(workspaceRoot());
loadDotEnv();
/** Só servimos arquivos de dentro do QAStage (artefatos, mapas). */
const ROOT = process.cwd();

/** Origens do shell e dos painéis (dev). Com cookie de sessão, CORS nunca pode ser "*". */
const ORIGENS = new Set(
  (process.env.QASTAGE_ALLOWED_ORIGINS ?? [5173, 5174, 5175, 5176, 5177].map((p) => `http://localhost:${p}`).join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

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

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers }).end(JSON.stringify(body));
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

/** Arquivo de execução/mapa: QA só de projetos atribuídos; fora de projeto, só admin. */
function exigirArquivo(u: Usuario, abs: string): void {
  if (ehAdmin(u)) return;
  const projeto = projetoDoArquivo(abs, ROOT, listProjects());
  if (!projeto || !podeVerProjeto(u, projeto)) throw new AcessoNegado("Sem acesso a este arquivo.");
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

/** Rotas abertas (antes do login). */
async function rotasDeSessao(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const { email, senha } = (await readBody(req)) as { email?: string; senha?: string };
    const login = String(email ?? "").trim().toLowerCase();
    const espera = bloqueado(login);
    if (espera) return json(res, 429, { error: `Muitas tentativas. Tente de novo em ${espera} s.` }), true;
    const u = buscarPorEmail(login);
    // Mesma resposta para e-mail inexistente e senha errada: não revela quem tem conta.
    if (!u || !u.ativo || !confereSenha(String(senha ?? ""), u.senhaHash)) {
      registrarFalha(login);
      return json(res, 401, { error: "E-mail ou senha incorretos." }), true;
    }
    limparFalhas(login);
    json(res, 200, { usuario: publico(u) }, { "set-cookie": cookieDeSessao(abrirSessao(u.id)) });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    fecharSessao(tokenDaRequisicao(req));
    json(res, 200, { ok: true }, { "set-cookie": cookieApagado });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const u = usuarioDaRequisicao(req);
    if (u) return json(res, 200, { usuario: publico(u) }), true;
    return json(res, 401, { error: "Não autenticado", setup: listarUsuarios().length === 0 }), true;
  }
  if (req.method === "POST" && url.pathname === "/api/auth/setup") {
    // Primeiro acesso: só enquanto não existe nenhum usuário.
    if (listarUsuarios().length > 0) return json(res, 403, { error: "O administrador já foi criado. Entre com login." }), true;
    const b = (await readBody(req)) as { nome?: string; email?: string; senha?: string };
    const u = criarUsuario({ nome: b.nome ?? "", email: b.email ?? "", senha: b.senha ?? "", papel: "admin" });
    json(res, 201, { usuario: publico(u) }, { "set-cookie": cookieDeSessao(abrirSessao(u.id)) });
    return true;
  }
  return false;
}

/** Administração de usuários. */
async function rotasDeAdmin(req: IncomingMessage, res: ServerResponse, url: URL, eu: Usuario): Promise<boolean> {
  if (!url.pathname.startsWith("/api/admin/")) return false;
  exigirAdmin(eu);

  if (url.pathname === "/api/admin/usuarios" && req.method === "GET") {
    return json(res, 200, listarUsuarios().map(publico)), true;
  }
  if (url.pathname === "/api/admin/usuarios" && req.method === "POST") {
    const b = (await readBody(req)) as { nome?: string; email?: string; papel?: "admin" | "qa"; projetos?: string[] };
    const senha = senhaTemporaria();
    const u = criarUsuario({ nome: b.nome ?? "", email: b.email ?? "", papel: b.papel ?? "qa", senha, projetos: b.projetos ?? [] });
    // A senha temporária aparece só nesta resposta; o admin repassa ao usuário.
    return json(res, 201, { usuario: publico(u), senhaTemporaria: senha }), true;
  }
  const m = url.pathname.match(/^\/api\/admin\/usuarios\/([\w-]+)$/);
  if (m && req.method === "PATCH") {
    const b = (await readBody(req)) as AlteracaoUsuario & { redefinirSenha?: boolean };
    const alteracao: AlteracaoUsuario = {};
    if (b.nome !== undefined) alteracao.nome = b.nome;
    if (b.papel !== undefined) alteracao.papel = b.papel;
    if (b.ativo !== undefined) alteracao.ativo = b.ativo;
    if (b.projetos !== undefined) alteracao.projetos = b.projetos;
    const novaSenha = b.redefinirSenha ? senhaTemporaria() : undefined;
    if (novaSenha) alteracao.senha = novaSenha;
    const u = alterarUsuario(m[1]!, alteracao);
    // Desativar, mudar papel ou redefinir senha derruba as sessões abertas dessa pessoa.
    if (b.ativo === false || b.papel !== undefined || novaSenha) fecharSessoesDe(u.id, u.id === eu.id ? tokenDaRequisicao(req) : undefined);
    return json(res, 200, { usuario: publico(u), ...(novaSenha ? { senhaTemporaria: novaSenha } : {}) }), true;
  }
  return false;
}

const server = createServer(async (req, res) => {
  const origem = req.headers.origin;
  if (origem && ORIGENS.has(origem)) {
    res.setHeader("access-control-allow-origin", origem);
    res.setHeader("access-control-allow-credentials", "true");
    res.setHeader("vary", "Origin");
  }
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();

  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    // Escrita só com JSON: formulário de outro site não consegue mandar (exige preflight do CORS).
    if (req.method !== "GET" && req.method !== "HEAD" && !String(req.headers["content-type"] ?? "").startsWith("application/json")) {
      return json(res, 415, { error: "Use content-type: application/json" });
    }

    if (await rotasDeSessao(req, res, url)) return;

    const eu = usuarioDaRequisicao(req);
    if (!eu) return json(res, 401, { error: "Não autenticado" });

    if (req.method === "POST" && url.pathname === "/api/auth/senha") {
      const { atual, nova } = (await readBody(req)) as { atual?: string; nova?: string };
      if (!confereSenha(String(atual ?? ""), eu.senhaHash)) return json(res, 400, { error: "Senha atual incorreta." });
      alterarUsuario(eu.id, { senha: String(nova ?? "") });
      fecharSessoesDe(eu.id, tokenDaRequisicao(req)); // outras sessões caem; esta segue
      return json(res, 200, { ok: true });
    }

    if (await rotasDeAdmin(req, res, url, eu)) return;

    if (url.pathname === "/api/projects") {
      if (req.method === "POST") {
        exigirAdmin(eu);
        const p = createProject((await readBody(req)) as NewProject);
        return json(res, 201, { id: p.id, name: p.name });
      }
      if (req.method === "GET") {
        const artifacts = join(ROOT, "artifacts");
        return json(
          res,
          200,
          listProjects()
            .filter((p) => podeVerProjeto(eu, p.id))
            .map((p) => {
              const base = { id: p.id, name: p.name, dir: relative(ROOT, p.dir) || "." };
              if (p.error) return { ...base, error: p.error };
              const features = listFeatures(p);
              const porPlugin: Record<string, number> = {};
              for (const f of features) porPlugin[f.plugin] = (porPlugin[f.plugin] ?? 0) + f.scenarios;
              const ultimas = listReports(artifacts, 5, p.id);
              return {
                ...base,
                padrao: p.config!.padrao ?? Object.keys(p.config!.ambientes)[0],
                ambientes: Object.keys(p.config!.ambientes).map((n) => resolveEnv(p.config, n)),
                cenarios: porPlugin,
                arquivos: features.length,
                ultimas: ultimas.map((r) => ({ id: r.id, plugin: r.plugin, status: r.status, startedAt: r.startedAt, env: r.env.name, counts: r.counts })),
              };
            }),
        );
      }
    }

    const mp = url.pathname.match(/^\/api\/projects\/([\w-]+)(\/features|\/file)?$/);
    if (mp) {
      exigirProjeto(eu, mp[1]!);
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
      // Config da raiz (modo sem projetos): só admin.
      exigirAdmin(eu);
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
      if (request.project) {
        exigirProjeto(eu, request.project);
        getProject(request.project);
      } else {
        exigirAdmin(eu); // execução fora de projeto: só admin
      }
      request.requestedBy = eu.nome;
      return json(res, 202, { id: startRun(request).id });
    }

    const m = url.pathname.match(/^\/api\/runs\/([\w-]+)$/);
    if (req.method === "GET" && m) {
      const record = runs.get(m[1]!);
      if (!record) return json(res, 404, { error: "Execução não encontrada" });
      if (record.request.project) exigirProjeto(eu, record.request.project);
      else exigirAdmin(eu);
      return json(res, 200, record);
    }

    if (req.method === "GET" && url.pathname === "/api/files") {
      const abs = resolve(url.searchParams.get("path") ?? "");
      exigirArquivo(eu, abs);
      return sendFile(res, abs, ROOT);
    }

    if (req.method === "GET" && url.pathname.startsWith("/artifacts/")) {
      const artifacts = join(ROOT, "artifacts");
      const abs = resolve(artifacts, "." + decodeURIComponent(url.pathname.slice("/artifacts".length)));
      exigirArquivo(eu, abs);
      return sendFile(res, abs, artifacts);
    }

    const rp = url.pathname.match(/^\/api\/plugins\/([\w-]+)(\/.*)$/);
    if (rp) {
      const plugin = registry.get(rp[1]!);
      const rota = plugin.routes?.find((r) => r.method === req.method && r.path === rp[2]);
      if (rota) {
        const pid = url.searchParams.get("project");
        if (pid) exigirProjeto(eu, pid);
        // Sem projeto, a rota pode enxergar dados de todos (ex.: histórico): QA só lê o vocabulário de passos.
        else if (!ehAdmin(eu) && !(req.method === "GET" && rp[2] === "/steps")) {
          throw new AcessoNegado("Informe o projeto (?project=<id>).");
        }
        const body = req.method === "GET" ? undefined : await readBody(req);
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
    if (e instanceof AcessoNegado) return json(res, e.status, { error: msg });
    json(res, /^(Plugin|Projeto ".*") não encontrado/.test(msg) ? 404 : 400, { error: msg });
  }
});

server.listen(PORT, () => {
  console.log(`QAStage runner em http://localhost:${PORT}`);
  if (listarUsuarios().length === 0) console.log("Nenhum usuário ainda: abra o shell para criar o administrador (ou: pnpm run runner -- usuarios admin <email> <nome>).");
});
