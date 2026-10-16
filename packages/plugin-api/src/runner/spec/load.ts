import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ApiSpec, Endpoint } from "./model";
import { loadOpenApi } from "./openapi";
import { fromPostman, isPostman } from "./postman";

const cache = new Map<string, Promise<ApiSpec>>();

/**
 * Carrega a fonte de endpoints (adapter por projeto): link do Swagger/OpenAPI,
 * arquivo YAML/JSON ou collection do Postman. Sem LLM: só parser.
 */
export function loadSpec(source: string, { fresh = false } = {}): Promise<ApiSpec> {
  const chave = /^https?:\/\//.test(source) ? source : resolve(source);
  if (fresh || !cache.has(chave)) {
    const p = carregar(chave);
    p.catch(() => cache.delete(chave));
    cache.set(chave, p);
  }
  return cache.get(chave)!;
}

async function carregar(source: string): Promise<ApiSpec> {
  const texto = /^https?:\/\//.test(source)
    ? await fetch(source, { signal: AbortSignal.timeout(15000) }).then((r) => {
        if (!r.ok) throw new Error(`Não consegui baixar o spec (${r.status}): ${source}`);
        return r.text();
      })
    : await readFile(source, "utf8");
  let doc: unknown;
  try {
    doc = JSON.parse(texto);
  } catch {
    /* YAML: o swagger-parser resolve */
  }
  if (isPostman(doc)) return fromPostman(doc, source);
  return loadOpenApi(source);
}

export interface EndpointMatch {
  endpoint: Endpoint;
  /** Parâmetros de path tirados do caminho concreto (GET /clientes/12 → { id: "12" }). */
  pathParams: Record<string, string>;
}

/**
 * Acha o endpoint que o QA citou: "POST /clientes", "GET /clientes/{id}",
 * "GET /clientes/12" (concreto) ou o operationId ("criarCliente").
 */
export function findEndpoint(spec: ApiSpec, ref: string): EndpointMatch {
  const r = ref.trim();
  const porOp = spec.endpoints.find((e) => e.operationId === r);
  if (porOp) return { endpoint: porOp, pathParams: {} };

  const m = r.match(/^([A-Za-z]+)\s+(\S+)$/);
  if (m) {
    const metodo = m[1]!.toUpperCase();
    const caminho = m[2]!.split("?")[0]!;
    for (const e of spec.endpoints.filter((x) => x.method === metodo)) {
      if (e.path === caminho) return { endpoint: e, pathParams: {} };
      const nomes: string[] = [];
      const re = new RegExp("^" + e.path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\?\{(\w+)\\?\}/g, (_, n: string) => (nomes.push(n), "([^/]+)")) + "$");
      const achou = caminho.match(re);
      if (achou) return { endpoint: e, pathParams: Object.fromEntries(nomes.map((n, i) => [n, decodeURIComponent(achou[i + 1]!)])) };
    }
  }
  const parecidos = spec.endpoints.map((e) => `  - ${e.id}${e.operationId ? ` (${e.operationId})` : ""}`).join("\n");
  throw new Error(`Endpoint "${ref}" não está em ${spec.title}. Disponíveis:\n${parecidos}`);
}
