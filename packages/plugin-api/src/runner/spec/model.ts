/** JSON Schema (o subconjunto que OpenAPI usa). Solto de propósito: vem de fora. */
export type JsonSchema = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Param {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema?: JsonSchema;
}

/**
 * Endpoint normalizado: OpenAPI 3, Swagger 2 e Postman viram este mesmo
 * formato. O resto do plugin não sabe de onde o endpoint veio.
 */
export interface Endpoint {
  /** "POST /clientes" — como o QA se refere ao endpoint no .feature. */
  id: string;
  method: string;
  /** Caminho com parâmetros no formato {id}. */
  path: string;
  operationId?: string;
  summary?: string;
  params: Param[];
  body?: { contentType: string; required: boolean; schema?: JsonSchema; example?: unknown };
  /** Por status ("200", "4XX", "default"): schema da resposta, se documentado. */
  responses: Record<string, { schema?: JsonSchema }>;
  /** Exige autenticação segundo a fonte. */
  secured: boolean;
}

export interface ApiSpec {
  /** De onde veio: URL ou caminho. */
  source: string;
  kind: "openapi3" | "swagger2" | "postman";
  title: string;
  endpoints: Endpoint[];
}
