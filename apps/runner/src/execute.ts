import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Logger, RunContext, RunResult } from "@qastage/core-contract";
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
}

/** Raiz do monorepo (onde está o pnpm-workspace.yaml); cai no cwd se não achar. */
export function workspaceRoot(from = process.cwd()): string {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) return resolve(from);
  }
}

/** Monta o RunContext e chama o executor do plugin. Ponto único para CLI e API. */
export async function executeRun(registry: PluginRegistry, req: RunRequest, logger: Logger): Promise<RunOutcome> {
  const plugin = registry.get(req.plugin);
  const artifactsDir = join(process.cwd(), "artifacts", req.plugin, String(Date.now()));
  mkdirSync(artifactsDir, { recursive: true });

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
  return { artifactsDir, result };
}
