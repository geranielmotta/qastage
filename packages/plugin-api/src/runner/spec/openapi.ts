import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPI, OpenAPIV2, OpenAPIV3 } from "openapi-types";
import type { ApiSpec, Endpoint, JsonSchema, Param } from "./model";

const METODOS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

/** Escolhe o conteúdo JSON (application/json, application/problem+json...). */
function jsonContent(content?: Record<string, OpenAPIV3.MediaTypeObject>): [string, OpenAPIV3.MediaTypeObject] | undefined {
  if (!content) return undefined;
  const entradas = Object.entries(content);
  return entradas.find(([t]) => /json/i.test(t)) ?? entradas[0];
}

/** OpenAPI 3.x ou Swagger 2.0, por URL ou arquivo (JSON ou YAML), com $ref resolvidos. */
export async function loadOpenApi(source: string): Promise<ApiSpec> {
  const api = (await SwaggerParser.dereference(source)) as OpenAPI.Document;
  const v2 = "swagger" in api;
  const raizSegura = ((api as { security?: unknown[] }).security ?? []).length > 0;
  const endpoints: Endpoint[] = [];

  for (const [path, item] of Object.entries(api.paths ?? {})) {
    if (!item) continue;
    const doPath = ((item as { parameters?: unknown[] }).parameters ?? []) as Array<OpenAPIV3.ParameterObject | OpenAPIV2.Parameter>;

    for (const metodo of METODOS) {
      const op = (item as Record<string, unknown>)[metodo] as (OpenAPIV3.OperationObject & OpenAPIV2.OperationObject) | undefined;
      if (!op) continue;

      // Parâmetros da operação sobrescrevem os do path (mesmo nome + local).
      const todos = [...doPath, ...((op.parameters ?? []) as typeof doPath)];
      const porChave = new Map(todos.map((p) => [`${p.in}:${p.name}`, p]));
      const params: Param[] = [];
      let body: Endpoint["body"];

      for (const p of porChave.values()) {
        if (p.in === "path" || p.in === "query" || p.in === "header") {
          const schema = v2 ? ({ type: (p as OpenAPIV2.GeneralParameterObject).type, format: (p as OpenAPIV2.GeneralParameterObject).format } as JsonSchema) : ((p as OpenAPIV3.ParameterObject).schema as JsonSchema);
          params.push({ name: p.name, in: p.in, required: !!p.required || p.in === "path", schema });
        } else if (v2 && p.in === "body") {
          body = { contentType: "application/json", required: !!p.required, schema: (p as OpenAPIV2.InBodyParameterObject).schema as JsonSchema };
        }
      }

      if (!v2 && op.requestBody) {
        const rb = op.requestBody as OpenAPIV3.RequestBodyObject;
        const c = jsonContent(rb.content);
        if (c) body = { contentType: c[0], required: !!rb.required, schema: c[1].schema as JsonSchema, example: c[1].example };
      }

      const responses: Endpoint["responses"] = {};
      for (const [status, r] of Object.entries(op.responses ?? {})) {
        const schema = v2 ? (r as OpenAPIV2.ResponseObject).schema : jsonContent((r as OpenAPIV3.ResponseObject).content)?.[1].schema;
        responses[status.toUpperCase()] = schema ? { schema: schema as JsonSchema } : {};
      }

      const seguranca = op.security ?? undefined;
      endpoints.push({
        id: `${metodo.toUpperCase()} ${path}`,
        method: metodo.toUpperCase(),
        path,
        ...(op.operationId ? { operationId: op.operationId } : {}),
        ...(op.summary ? { summary: op.summary } : {}),
        params,
        ...(body ? { body } : {}),
        responses,
        secured: seguranca ? seguranca.length > 0 : raizSegura,
      });
    }
  }

  return { source, kind: v2 ? "swagger2" : "openapi3", title: api.info?.title ?? source, endpoints };
}
