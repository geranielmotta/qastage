import { resolve, sep } from "node:path";
import type { PluginApiRoute, ProjectRef } from "@qastage/core-contract";
import { requiredFields } from "./body";
import { loadSpec } from "./spec/load";
import { apiSteps } from "./steps";

/** Arquivo local relativo ao projeto e só de dentro dele (ou do QAStage); URL passa direto. */
function fonte(raw: unknown, project?: ProjectRef): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) throw new Error("Informe ?spec=<link ou arquivo do Swagger/OpenAPI/Postman>");
  if (/^https?:\/\//.test(s)) return s;
  const abs = resolve(project?.dir ?? process.cwd(), s);
  const permitidas = [project?.dir, process.cwd()].filter(Boolean) as string[];
  if (!permitidas.some((d) => abs.startsWith(d + sep))) throw new Error(`Arquivo fora do projeto: ${abs}`);
  return abs;
}

/** Rotas do api-testing montadas em /api/plugins/api-testing/... */
export const apiRoutes: PluginApiRoute[] = [
  { method: "GET", path: "/steps", handle: async () => apiSteps.list() },
  {
    // Endpoints da fonte, resumidos para o painel montar os passos.
    method: "GET",
    path: "/endpoints",
    handle: async ({ query, project }) => {
      const spec = await loadSpec(fonte(query.spec, project), { fresh: query.fresh === "true" });
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
