import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Logger, ProjectRef, RunContext, RunFinishedEvent, RunResult } from "@qastage/core-contract";
import { writeReport, type RunReport } from "@qastage/reports";
import { loadProjectConfig, pluginParams, resolveEnv } from "./config";
import { getProject, insideProject } from "./projects";
import type { PluginRegistry } from "./registry";

/** Pedido de execução, vindo da CLI ou da API HTTP. */
export interface RunRequest {
  plugin: string;
  /** Id do projeto (pasta em projetos/). Sem projeto: config da raiz, se houver. */
  project?: string;
  /** Nome do ambiente (resolvido pela config do projeto) e sobrescritas opcionais de URL. */
  env: { name?: string; baseUrl?: string; apiUrl?: string; authUrl?: string };
  /** Caminho de um .feature em disco (relativo ao projeto, quando há projeto)... */
  featurePath?: string;
  /** ...ou o texto do .feature (o shell manda o que o QA escreveu). */
  featureText?: string;
  params?: Record<string, unknown>;
  /** Quem pediu a execução (nome do usuário logado), para o relatório. */
  requestedBy?: string;
}

export interface RunOutcome {
  artifactsDir: string;
  result: RunResult;
  /** report.html gerado pelo módulo de reports (ausente se a gravação falhou). */
  reportHtml?: string;
  /** O relatório gravado (report.json): o banco guarda o resumo dele. */
  report?: RunReport;
  /** Ambiente resolvido (nome), para o histórico. */
  envName: string;
  /** Log da execução, para o histórico. */
  logs: string[];
  /**
   * Ganchos onRunFinished dos plugins (Jira...), já disparados em segundo plano.
   * A CLI aguarda para o processo não sair antes; a API não aguarda. Nunca rejeita.
   */
  hooks: Promise<void>;
}

/** Raiz do monorepo (onde está o pnpm-workspace.yaml); cai no cwd se não achar. */
export function workspaceRoot(from = process.cwd()): string {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) return resolve(from);
  }
}

/** Monta o RunContext e chama o executor do plugin. Ponto único para CLI e API. */
export async function executeRun(registry: PluginRegistry, req: RunRequest, baseLogger: Logger): Promise<RunOutcome> {
  const plugin = registry.get(req.plugin);
  if (!plugin.createExecutor) throw new Error(`O plugin "${req.plugin}" não executa testes.`);
  const entry = req.project ? getProject(req.project) : undefined;
  const project: ProjectRef | undefined = entry ? { id: entry.id, name: entry.name, dir: entry.dir } : undefined;
  const artifactsRoot = join(process.cwd(), "artifacts");
  // Histórico separado por projeto: artifacts/<projeto>/<plugin>/<execução>
  const artifactsDir = join(artifactsRoot, project?.id ?? "_sem-projeto", req.plugin, String(Date.now()));
  mkdirSync(artifactsDir, { recursive: true });

  // O log da execução vai para o relatório, além do destino original.
  const logs: string[] = [];
  const hora = () => new Date().toISOString().slice(11, 19);
  const logger: Logger = {
    info: (m) => (logs.push(`${hora()} info  ${m}`), baseLogger.info(m)),
    warn: (m) => (logs.push(`${hora()} aviso ${m}`), baseLogger.warn(m)),
    error: (m) => (logs.push(`${hora()} erro  ${m}`), baseLogger.error(m)),
  };

  let featurePath = req.featurePath;
  if (featurePath && project && !isAbsolute(featurePath) && !existsSync(featurePath)) featurePath = insideProject(project, featurePath);
  if (req.featureText !== undefined) {
    featurePath = join(artifactsDir, "cenario.feature");
    writeFileSync(featurePath, req.featureText, "utf8");
  }

  const cfg = entry ? entry.config : loadProjectConfig();
  const ctx: RunContext = {
    env: resolveEnv(cfg, req.env.name, req.env),
    ...(project ? { project } : {}),
    featurePath,
    artifactsDir,
    logger,
    params: pluginParams(cfg, req.plugin, req.params),
  };

  const urls = ctx.env.apiUrl && ctx.env.apiUrl !== ctx.env.baseUrl ? `front ${ctx.env.baseUrl} · api ${ctx.env.apiUrl}` : ctx.env.baseUrl;
  const flags = [ctx.env.writable ? "escrita" : "só leitura", ...(ctx.env.allowLoad ? ["carga liberada"] : [])].join(", ");
  logger.info(`Executando "${req.plugin}" no ambiente "${ctx.env.name}" (${urls}; ${flags})${cfg ? ` — projeto ${cfg.projeto}` : ""}`);
  const result = await plugin.createExecutor().run(ctx);

  // Relatório para toda execução, de qualquer plugin. Falhar aqui nunca derruba o resultado.
  let reportHtml: string | undefined;
  let report: RunReport | undefined;
  let dirs: string[] = [];
  try {
    const w = writeReport({ artifactsRoot, artifactsDir, plugin: req.plugin, ...(project ? { project: { id: project.id, name: project.name } } : {}), ...(req.requestedBy ? { requestedBy: req.requestedBy } : {}), env: { name: ctx.env.name, baseUrl: ctx.env.apiUrl ?? ctx.env.baseUrl }, result, logs });
    reportHtml = w.htmlPath;
    report = w.report;
    dirs = w.report.failures.map((f) => join(artifactsDir, f.dir));
  } catch (e) {
    baseLogger.warn(`Relatório não gravado: ${(e as Error).message}`);
  }

  const event: RunFinishedEvent = {
    plugin: req.plugin,
    ...(project ? { project } : {}),
    env: { name: ctx.env.name, baseUrl: ctx.env.apiUrl ?? ctx.env.baseUrl },
    artifactsDir,
    result,
    failures: (result.failures ?? []).map((f, i) => (dirs[i] ? { ...f, packageDir: dirs[i] } : { ...f })),
    reportPath: reportHtml,
    logger: baseLogger,
  };
  const hooks = runHooks(registry, event);
  return { artifactsDir, result, hooks, envName: ctx.env.name, logs, ...(reportHtml ? { reportHtml } : {}), ...(report ? { report } : {}) };
}

/** Chama onRunFinished de todos os plugins em paralelo; um gancho com erro não afeta os outros. */
async function runHooks(registry: PluginRegistry, event: RunFinishedEvent): Promise<void> {
  await Promise.all(
    registry
      .list()
      .filter((p) => p.onRunFinished)
      .map((p) =>
        p.onRunFinished!(event).catch((e: Error) => event.logger.warn(`Integração "${p.manifest.name}" falhou: ${e.message}`)),
      ),
  );
}
