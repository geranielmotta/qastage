import type { ApiSpec, Endpoint, JsonSchema } from "./model";

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: {
    method?: string;
    url?: string | { raw?: string; path?: string[] };
    body?: { mode?: string; raw?: string };
    auth?: { type?: string };
  };
}

interface PostmanCollection {
  info?: { name?: string; schema?: string; _postman_id?: string };
  item?: PostmanItem[];
  auth?: { type?: string };
}

export function isPostman(doc: unknown): doc is PostmanCollection {
  const d = doc as PostmanCollection;
  return !!d && typeof d === "object" && Array.isArray(d.item) && (!!d.info?._postman_id || /postman/i.test(d.info?.schema ?? ""));
}

/** Schema inferido de um exemplo: a collection antiga não tem contrato, só exemplos. */
export function inferSchema(v: unknown): JsonSchema {
  if (v === null) return { nullable: true };
  if (Array.isArray(v)) return { type: "array", items: v.length ? inferSchema(v[0]) : {} };
  if (typeof v === "object") {
    const props = Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, inferSchema(x)]));
    return { type: "object", properties: props, required: Object.keys(props) };
  }
  if (typeof v === "number") return { type: Number.isInteger(v) ? "integer" : "number" };
  return { type: typeof v };
}

/** "{{baseUrl}}/clientes/:id?x=1" → "/clientes/{id}" */
function pathOf(url: NonNullable<PostmanItem["request"]>["url"]): string {
  const raw = typeof url === "string" ? url : url?.path ? "/" + url.path.join("/") : (url?.raw ?? "/");
  const semHost = raw.replace(/^\{\{[^}]+\}\}/, "").replace(/^https?:\/\/[^/]+/, "");
  const path = semHost.split("?")[0]!.replace(/:([A-Za-z_]\w*)/g, "{$1}").replace(/\{\{(\w+)\}\}/g, "{$1}");
  return path.startsWith("/") ? path : "/" + path;
}

/** Postman collection v2.x: cada request vira um endpoint; corpo de exemplo vira schema inferido. */
export function fromPostman(doc: PostmanCollection, source: string): ApiSpec {
  const endpoints: Endpoint[] = [];
  const visitar = (itens: PostmanItem[]) => {
    for (const it of itens) {
      if (it.item) visitar(it.item);
      if (!it.request) continue;
      const method = (it.request.method ?? "GET").toUpperCase();
      const path = pathOf(it.request.url);
      let example: unknown;
      if (it.request.body?.mode === "raw" && it.request.body.raw) {
        try {
          example = JSON.parse(it.request.body.raw.replace(/\{\{\w+\}\}/g, "0"));
        } catch {
          /* corpo não-JSON: segue sem exemplo */
        }
      }
      const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1]!, in: "path" as const, required: true }));
      endpoints.push({
        id: `${method} ${path}`,
        method,
        path,
        ...(it.name ? { summary: it.name } : {}),
        params,
        ...(example !== undefined ? { body: { contentType: "application/json", required: true, schema: inferSchema(example), example } } : {}),
        responses: {},
        secured: (it.request.auth?.type ?? doc.auth?.type ?? "noauth") !== "noauth",
      });
    }
  };
  visitar(doc.item ?? []);
  return { source, kind: "postman", title: doc.info?.name ?? source, endpoints };
}
