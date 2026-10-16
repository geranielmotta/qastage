import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Executor,
  RunContext,
  RunResult,
  RunnerPlugin,
} from "@qastage/core-contract";

/**
 * Executor de exemplo: não abre navegador nem chama API. Ele só prova que o
 * contrato roda ponta a ponta — o runner carrega o plugin, chama run(ctx),
 * recebe um RunResult e os artefatos ficam em disco.
 */
class ExampleExecutor implements Executor {
  async run(ctx: RunContext): Promise<RunResult> {
    const startedAt = new Date().toISOString();
    ctx.logger.info("plugin-example: iniciando o cenário de exemplo");

    const steps: RunResult["steps"] = [
      { name: "Dado que o runner carregou o plugin", status: "passed", durationMs: 1 },
      { name: `Quando executo no ambiente "${ctx.env.name}"`, status: "passed", durationMs: 1 },
      { name: "Então recebo um RunResult com artefatos", status: "passed", durationMs: 1 },
    ];

    const relatorio = join(ctx.artifactsDir, "exemplo.txt");
    writeFileSync(
      relatorio,
      `Execução do plugin-example em ${ctx.env.baseUrl} (${ctx.env.name})\n`,
      "utf8",
    );

    const finishedAt = new Date().toISOString();
    return {
      status: "passed",
      steps,
      artifacts: [{ kind: "report", path: relatorio, label: "relatório de exemplo" }],
      startedAt,
      finishedAt,
    };
  }
}

/** A metade "runner" do plugin. */
export const examplePlugin: RunnerPlugin = {
  manifest: {
    name: "example",
    version: "0.0.0",
    description: "Plugin de exemplo que prova o contrato ponta a ponta.",
  },
  createExecutor: () => new ExampleExecutor(),
};
