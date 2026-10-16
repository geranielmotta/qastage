import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Logger, RunContext, RunFinishedEvent, RunResult } from "@qastage/core-contract";
import { writeReport } from "@qastage/reports";
import { loadProjectConfig, pluginParams, resolveEnv } from "./config";
import type { PluginRegistry } from "./registry";

/** Pedido de execução, vindo da CLI ou da API HTTP. */
export interface RunRequest {
  plugin: string;
  /** Nome do ambiente (resolvido pela config do projeto) e sobrescritas opcionais de URL. */
  env: { name?: string; baseUrl?: string; apiUrl?: string; authUrl?: string };
  /** Caminho de um .feature em disco... */
  featurePath?: string;
  /** ...ou o texto do .feature (o shell manda o que o QA escreveu). */
  featureText?: string;
  params?: Record<string, unknown>;
}

export interface RunOutcome {
  artifactsDir: string;
  result: RunResult;
  /** report.html gerado pelo módulo de reports (ausente se a gravação falhou). */
  reportHtml?: string;
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
  const artifactsRoot = join(process.cwd(), "artifacts");
  const artifactsDir = join(artifactsRoot, req.plugin, String(Date.now()));
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
  if (req.featureText !== undefined) {
    featurePath = join(artifactsDir, "cenario.feature");
    writeFileSync(featurePath, req.featureText, "utf8");
  }

  const cfg = loadProjectConfig();
  const ctx: RunContext = {
    env: resolveEnv(cfg, req.env.name, req.env),
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
  let dirs: string[] = [];
  try {
    const w = writeReport({ artifactsRoot, artifactsDir, plugin: req.plugin, env: { name: ctx.env.name, baseUrl: ctx.env.apiUrl ?? ctx.env.baseUrl }, result, logs });
    reportHtml = w.htmlPath;
    dirs = w.report.failures.map((f) => join(artifactsDir, f.dir));
  } catch (e) {
    baseLogger.warn(`Relatório não gravado: ${(e as Error).message}`);
  }

  const event: RunFinishedEvent = {
    plugin: req.plugin,
    env: { name: ctx.env.name, baseUrl: ctx.env.apiUrl ?? ctx.env.baseUrl },
    artifactsDir,
    result,
    failures: (result.failures ?? []).map((f, i) => (dirs[i] ? { ...f, packageDir: dirs[i] } : { ...f })),
    reportPath: reportHtml,
    logger: baseLogger,
  };
  const hooks = runHooks(registry, event);
  return reportHtml ? { artifactsDir, result, reportHtml, hooks } : { artifactsDir, result, hooks };
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
