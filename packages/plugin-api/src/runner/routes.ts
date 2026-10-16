import { resolve, sep } from "node:path";
import type { PluginApiRoute } from "@qastage/core-contract";
import { requiredFields } from "./body";
import { loadSpec } from "./spec/load";
import { apiSteps } from "./steps";

/** Arquivo local só de dentro do projeto; URL passa direto. */
function fonte(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) throw new Error("Informe ?spec=<link ou arquivo do Swagger/OpenAPI/Postman>");
  if (/^https?:\/\//.test(s)) return s;
  const abs = resolve(s);
  if (!abs.startsWith(process.cwd() + sep)) throw new Error(`Arquivo fora do projeto: ${abs}`);
  return abs;
}

/** Rotas do api-testing montadas em /api/plugins/api-testing/... */
export const apiRoutes: PluginApiRoute[] = [
  { method: "GET", path: "/steps", handle: async () => apiSteps.list() },
  {
    // Endpoints da fonte, resumidos para o painel montar os passos.
    method: "GET",
    path: "/endpoints",
    handle: async ({ query }) => {
      const spec = await loadSpec(fonte(query.spec), { fresh: query.fresh === "true" });
      return {
        title: spec.title,
        kind: spec.kind,
        endpoints: spec.endpoints.map((e) => ({
          id: e.id,
          method: e.method,
          path: e.path,
          operationId: e.operationId,
          summary: e.summary,
          secured: e.secured,
          hasBody: !!e.body,
          required: requiredFields(e.body?.schema),
          statuses: Object.keys(e.responses),
        })),
      };
    },
  },
];
