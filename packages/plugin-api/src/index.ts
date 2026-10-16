import type { RunnerPlugin } from "@qastage/core-contract";
import { ApiExecutor } from "./runner/executor";
import { apiRoutes } from "./runner/routes";

export { apiSteps } from "./runner/steps";
export { loadSpec, findEndpoint } from "./runner/spec/load";
export { generate, coerce, schemaAt, setPath } from "./runner/body";
export type { ApiSpec, Endpoint } from "./runner/spec/model";

/**
 * A metade "runner" do plugin api-testing: lê a fonte de endpoints (OpenAPI 3,
 * Swagger 2 ou Postman), gera corpo válido pelo schema + módulo de dados,
 * valida a resposta contra o contrato (ajv) e roda negativos em lote.
 */
export const apiPlugin: RunnerPlugin = {
  manifest: {
    name: "api-testing",
    version: "0.0.0",
    description: "Testes de API: Swagger/OpenAPI/Postman, corpo gerado, contrato e negativos.",
    webRemote: {
      name: "qastage_api",
      entry: process.env.QASTAGE_API_REMOTE ?? "http://localhost:5176/remoteEntry.js",
      module: "./Panel",
      title: "APIs",
      route: "/api",
    },
  },
  createExecutor: () => new ApiExecutor(),
  routes: apiRoutes,
};
