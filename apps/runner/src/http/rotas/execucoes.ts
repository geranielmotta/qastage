import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { Artifact, Logger, RunResult } from "@qastage/core-contract";
import type { RunReport } from "@qastage/reports";
import type { FastifyInstance } from "fastify";
import { ehAdmin, exigirAdmin, exigirProjeto } from "../../auth/access";
import { auditar } from "../../db/auditoria";
import { listarExecucoes, obterExecucao } from "../../db/execucoes";
import { executarRegistrando } from "../../execucao";
import type { RunRequest } from "../../execute";
import { featureFile, getProject } from "../../projects";
import { artifactsDe, eu, quem, type Contexto } from "../contexto";

/** O que o painel acompanha por polling (mesmo formato de antes do banco). */
interface AoVivo {
  id: string;
  request: RunRequest;
  state: "running" | "done";
  logs: Array<{ level: "info" | "warn" | "error"; msg: string }>;
  result?: RunResult;
  reportUrl?: string;
}

/** Execuções deste processo, com o log ao vivo. Somem 1 h depois de terminar (o banco guarda o histórico). */
const aoVivo = new Map<string, AoVivo>();
const RETER_MS = 60 * 60 * 1000;

function validar(body: unknown): RunRequest {
  const b = (body ?? {}) as Partial<RunRequest>;
  if (typeof b.plugin !== "string") throw new Error("Campo obrigatório: plugin");
  const e = b.env ?? {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const project = str(b.project);
  const featurePath = str(b.featurePath);
  // Arquivo em disco só de dentro de um projeto (features/...); fora disso, use featureText.
  if (featurePath && !project) throw new Error("featurePath exige project");
  if (featurePath && project) featureFile(getProject(project), featurePath);
  return {
    plugin: b.plugin,
    ...(project ? { project } : {}),
    env: { name: str(e.name), baseUrl: str(e.baseUrl), apiUrl: str(e.apiUrl), authUrl: str(e.authUrl) },
    ...(typeof b.featureText === "string" ? { featureText: b.featureText } : {}),
    ...(featurePath ? { featurePath } : {}),
    params: b.params ?? {},
  };
}

/** Reconstrói o resultado completo a partir do report.json (execução de outro processo ou de antes de reiniciar). */
function doRelatorio(artifacts: string, reportId: string): RunResult | undefined {
  const file = join(artifacts, reportId, "report.json");
  if (!existsSync(file)) return undefined;
  const r = JSON.parse(readFileSync(file, "utf8")) as RunReport;
  const abs = (a: Artifact): Artifact => ({ ...a, path: isAbsolute(a.path) ? a.path : join(artifacts, reportId, a.path) });
  return {
    status: r.status,
    steps: r.scenarios.flatMap((s) => s.steps.map((st) => ({ ...st, ...(st.artifacts ? { artifacts: st.artifacts.map(abs) } : {}) }))),
    artifacts: r.artifacts.map(abs),
    ...(r.metrics ? { metrics: r.metrics } : {}),
    ...(r.error ? { error: r.error } : {}),
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  };
}

export async function rotasExecucoes(app: FastifyInstance, ctx: Contexto): Promise<void> {
  const artifacts = artifactsDe(ctx.raiz);

  app.post("/api/runs", async (req, reply) => {
    const u = eu(req);
    const pedido = validar(req.body);
    const plugin = ctx.registry.get(pedido.plugin); // 404 cedo se o plugin não existe
    if (!plugin.createExecutor) throw new Error(`O plugin "${pedido.plugin}" não executa testes.`);
    if (pedido.project) {
      exigirProjeto(u, pedido.project);
      getProject(pedido.project);
    } else {
      exigirAdmin(u); // execução fora de projeto: só admin
    }
    pedido.requestedBy = u.nome;

    const vivo: AoVivo = { id: "", request: pedido, state: "running", logs: [] };
    const log = (level: AoVivo["logs"][number]["level"]) => (msg: string) => {
      vivo.logs.push({ level, msg });
      req.log.info({ execucao: vivo.id.slice(0, 8) }, msg);
    };
    const logger: Logger = { info: log("info"), warn: log("warn"), error: log("error") };

    const ex = await executarRegistrando(ctx.registry, pedido, logger, { origem: "api", usuario: u });
    vivo.id = ex.id;
    aoVivo.set(ex.id, vivo);
    ex.fim
      .then((out) => {
        vivo.result = out.result;
        if (out.reportHtml) vivo.reportUrl = "/" + relative(ctx.raiz, out.reportHtml).split(sep).join("/");
      })
      .catch((e: Error) => {
        const agora = new Date().toISOString();
        vivo.result = { status: "error", error: e.message, artifacts: [], startedAt: agora, finishedAt: agora };
      })
      .finally(() => {
        vivo.state = "done";
        setTimeout(() => aoVivo.delete(ex.id), RETER_MS).unref();
      });

    await auditar("execucao_iniciada", quem(req), pedido.project ?? "(sem projeto)", { execucao: ex.id, plugin: pedido.plugin, ambiente: pedido.env.name }, req.ip);
    return reply.code(202).send({ id: ex.id });
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (req, reply) => {
    const u = eu(req);
    const vivo = aoVivo.get(req.params.id);
    const linha = vivo ? undefined : await obterExecucao(req.params.id);
    const projeto = vivo ? vivo.request.project : linha?.project?.id;
    if (!vivo && !linha) return reply.code(404).send({ error: "Execução não encontrada" });
    if (projeto) exigirProjeto(u, projeto);
    else exigirAdmin(u);
    if (vivo) return vivo;

    const result = linha!.reportId ? doRelatorio(artifacts, linha!.reportId) : undefined;
    return {
      id: linha!.id,
      state: linha!.status === "running" ? "running" : "done",
      logs: (linha!.logs as string[]).map((msg) => ({ level: "info", msg })),
      ...(result ? { result } : linha!.status !== "running" ? { result: { status: linha!.status, error: linha!.erro, artifacts: [], startedAt: linha!.startedAt, finishedAt: linha!.startedAt } } : {}),
      ...(linha!.reportUrl ? { reportUrl: linha!.reportUrl } : {}),
    };
  });

  /** Histórico: de um projeto (?project=) ou de todos os visíveis. */
  app.get<{ Querystring: { project?: string; limit?: string } }>("/api/runs", async (req) => {
    const u = eu(req);
    const limite = Number(req.query.limit ?? 100);
    if (req.query.project) {
      exigirProjeto(u, req.query.project);
      return listarExecucoes({ projetos: [req.query.project], limite });
    }
    if (ehAdmin(u)) return listarExecucoes({ limite });
    if (!u.projetos.length) return [];
    return listarExecucoes({ projetos: u.projetos, limite });
  });
}
