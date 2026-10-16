import type { Logger } from "@qastage/core-contract";
import { createRegistry } from "./bootstrap";
import { executeRun } from "./execute";

const logger: Logger = {
  info: (m) => console.log(`[info] ${m}`),
  warn: (m) => console.warn(`[aviso] ${m}`),
  error: (m) => console.error(`[erro] ${m}`),
};

const OPCOES_DO_RUNNER = new Set(["env", "url", "authUrl", "feature"]);

interface ParsedArgs {
  comando: string | undefined;
  pluginName: string | undefined;
  opts: Record<string, string>;
}

/**
 * Uso: run <plugin> [--env qa] [--url http://...] [--feature caminho.feature] [--<param> valor ...]
 * Opções que o runner não conhece viram params do plugin (ex.: --mode scan --paths /login).
 */
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
    logger.error("Uso: run <plugin> [--env qa] [--url http://...] [--feature caminho.feature] [--<param> valor ...]");
    process.exitCode = 1;
    return;
  }

  const { result } = await executeRun(
    registry,
    {
      plugin: pluginName,
      env: { name: opts.env ?? "local", baseUrl: opts.url ?? "http://localhost:3000", authUrl: opts.authUrl },
      featurePath: opts.feature,
      params: Object.fromEntries(Object.entries(opts).filter(([k]) => !OPCOES_DO_RUNNER.has(k))),
    },
    logger,
  );

  logger.info(`Resultado: ${result.status}`);
  for (const step of result.steps ?? []) {
    logger.info(`  ${step.status === "passed" ? "✓" : step.status === "skipped" ? "-" : "✗"} ${step.name}`);
  }
  for (const a of result.artifacts) {
    logger.info(`  artefato: ${a.kind} -> ${a.path}`);
  }

  if (result.status === "error" && result.error) logger.error(result.error);
  if (result.status !== "passed") process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
