import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger, RunContext } from "@qastage/core-contract";
import { createRegistry } from "./bootstrap";

const logger: Logger = {
  info: (m) => console.log(`[info] ${m}`),
  warn: (m) => console.warn(`[aviso] ${m}`),
  error: (m) => console.error(`[erro] ${m}`),
};

interface ParsedArgs {
  comando: string | undefined;
  pluginName: string | undefined;
  opts: Record<string, string>;
}

/** Uso: run <plugin> [--env qa] [--url http://...] [--feature caminho.feature] */
function parseArgs(argv: string[]): ParsedArgs {
  const [comando, pluginName, ...rest] = argv;
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const chave = rest[i]?.replace(/^--/, "");
    const valor = rest[i + 1];
    if (chave && valor !== undefined) opts[chave] = valor;
  }
  return { comando, pluginName, opts };
}

async function main(): Promise<void> {
  const registry = createRegistry();
  // Alguns gerenciadores (pnpm) repassam um "--" literal; ignoramos esses tokens.
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const { comando, pluginName, opts } = parseArgs(argv);

  if (!comando || comando === "list") {
    console.log("Plugins disponíveis:");
    for (const p of registry.list()) {
      console.log(`  - ${p.manifest.name}@${p.manifest.version}  ${p.manifest.description ?? ""}`);
    }
    return;
  }

  if (comando !== "run" || !pluginName) {
    logger.error("Uso: run <plugin> [--env qa] [--url http://...] [--feature caminho.feature]");
    process.exitCode = 1;
    return;
  }

  const plugin = registry.get(pluginName);
  const envName = opts.env ?? "local";
  const artifactsDir = resolve(process.cwd(), "artifacts", pluginName, String(Date.now()));
  mkdirSync(artifactsDir, { recursive: true });

  const ctx: RunContext = {
    env: {
      name: envName,
      baseUrl: opts.url ?? "http://localhost:3000",
      authUrl: opts.authUrl,
      // Por padrão, homolog não é "seguro para escrita" sem confirmação.
      writable: envName !== "homolog",
    },
    featurePath: opts.feature,
    artifactsDir,
    logger,
    params: {},
  };

  logger.info(`Executando "${pluginName}" no ambiente "${ctx.env.name}" (${ctx.env.baseUrl})`);
  const result = await plugin.createExecutor().run(ctx);

  logger.info(`Resultado: ${result.status}`);
  for (const step of result.steps ?? []) {
    logger.info(`  ${step.status === "passed" ? "✓" : "✗"} ${step.name}`);
  }
  for (const a of result.artifacts) {
    logger.info(`  artefato: ${a.kind} -> ${a.path}`);
  }

  if (result.status !== "passed") process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
