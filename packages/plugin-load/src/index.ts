import type { RunnerPlugin } from "@qastage/core-contract";
import { LoadExecutor } from "./runner/executor";
import { loadSteps } from "./runner/steps";

export { loadSteps } from "./runner/steps";

/**
 * A metade "runner" do plugin load-testing: o .feature descreve carga, mix
 * de endpoints e limites; o plugin gera o script k6 (corpo pelo schema +
 * módulo de dados), roda o k6 e devolve as métricas ao reports.
 */
export const loadPlugin: RunnerPlugin = {
  manifest: {
    name: "load-testing",
    version: "0.0.0",
    description: "Carga com k6: script gerado dos endpoints e dados, com limites (p95, erros, vazão).",
    webRemote: {
      name: "qastage_load",
      entry: process.env.QASTAGE_LOAD_REMOTE ?? "http://localhost:5177/remoteEntry.js",
      module: "./Panel",
      title: "Carga",
      route: "/load",
    },
  },
  createExecutor: () => new LoadExecutor(),
  routes: [{ method: "GET", path: "/steps", handle: async () => loadSteps.list() }],
};
