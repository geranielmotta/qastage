import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Logger, RunContext, RunFinishedEvent, RunResult } from "@qastage/core-contract";
import { writeReport } from "@qastage/reports";
import type { PluginRegistry } from "./registry";

/** Pedido de execução, vindo da CLI ou da API HTTP. */
export interface RunRequest {
  plugin: string;
  env: { name: string; baseUrl: string; authUrl?: string };
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

  const ctx: RunContext = {
    env: {
      ...req.env,
      // Por padrão, homolog não é "seguro para escrita" sem confirmação.
      writable: req.env.name !== "homolog",
    },
    featurePath,
    artifactsDir,
    logger,
    params: req.params ?? {},
  };

  logger.info(`Executando "${req.plugin}" no ambiente "${ctx.env.name}" (${ctx.env.baseUrl})`);
  const result = await plugin.createExecutor().run(ctx);

  // Relatório para toda execução, de qualquer plugin. Falhar aqui nunca derruba o resultado.
  let reportHtml: string | undefined;
  let dirs: string[] = [];
  try {
    const w = writeReport({ artifactsRoot, artifactsDir, plugin: req.plugin, env: req.env, result, logs });
    reportHtml = w.htmlPath;
    dirs = w.report.failures.map((f) => join(artifactsDir, f.dir));
  } catch (e) {
    baseLogger.warn(`Relatório não gravado: ${(e as Error).message}`);
  }

  const event: RunFinishedEvent = {
    plugin: req.plugin,
    env: { name: req.env.name, baseUrl: req.env.baseUrl },
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
