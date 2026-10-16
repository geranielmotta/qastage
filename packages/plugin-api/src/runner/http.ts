import { isSensitiveField } from "@qastage/data";
import { coerce, generate, schemaAt, setPath } from "./body";
import { findEndpoint } from "./spec/load";
import type { ApiWorld, Exchange } from "./world";

const LEITURA = new Set(["GET", "HEAD", "OPTIONS"]);

/** "{{id}}" → valor guardado; "${VAR}" → variável de ambiente (segredos fora do .feature). */
export function interpolate(w: ApiWorld, texto: string): string {
  return texto
    .replace(/\$\{(\w+)\}/g, (_, n: string) => {
      const v = process.env[n];
      if (v === undefined) throw new Error(`Variável de ambiente ${n} não definida (use o .env da raiz).`);
      if (isSensitiveField(n)) w.secrets.add(v);
      return v;
    })
    .replace(/\{\{(\w+)\}\}/g, (_, n: string) => {
      if (!(n in w.vars)) throw new Error(`"{{${n}}}" não foi guardado. Use antes: eu guardo o campo "..." da resposta como "${n}"`);
      return String(w.vars[n]);
    });
}

export interface SendOptions {
  /** Linhas | campo | valor | da tabela do passo: sobrescrevem o corpo gerado. */
  overrides?: string[][];
  /** Ajuste final do corpo (negativos: tirar campo, trocar tipo). */
  mutate?: (body: Record<string, unknown>) => void;
  /** Corpo exato, sem geração (login). */
  rawBody?: Record<string, unknown>;
  label?: string;
  /** Login é POST mas não grava nada: liberado mesmo em ambiente só-leitura. */
  readOnlyIntent?: boolean;
}

/** Monta e envia a requisição para o endpoint citado pelo QA. */
export async function send(w: ApiWorld, ref: string, opts: SendOptions = {}): Promise<Exchange> {
  if (!w.spec) throw new Error('Nenhuma fonte de endpoints. Use o passo: Dado que a API é descrita em "<link ou arquivo do Swagger/Postman>"');
  const alvo = interpolate(w, ref);
  const { endpoint, pathParams } = findEndpoint(w.spec, alvo);

  if (!LEITURA.has(endpoint.method) && !w.writable && !opts.readOnlyIntent) {
    throw new Error(
      `O ambiente "${w.envName}" não aceita escrita: ${endpoint.id} criaria/alteraria registros de verdade. ` +
        `Rode num ambiente marcado como gravável.`,
    );
  }

  const caminho = endpoint.path.replace(/\{(\w+)\}/g, (_, n: string) => {
    const v = pathParams[n] ?? w.vars[n];
    if (v === undefined) throw new Error(`Falta o parâmetro {${n}} de ${endpoint.id}: escreva o caminho concreto ou guarde "${n}" de uma resposta anterior.`);
    return encodeURIComponent(String(v));
  });
  const query = alvo.includes("?") ? "?" + alvo.split("?")[1] : "";
  const url = w.baseUrl.replace(/\/+$/, "") + caminho + query;

  let body: Record<string, unknown> | undefined;
  if (opts.rawBody) body = opts.rawBody;
  else if (endpoint.body) body = (generate(endpoint.body.schema, w.rng) ?? {}) as Record<string, unknown>;
  for (const [campo, valor] of opts.overrides ?? []) {
    if (!body) body = {};
    setPath(body, campo!, coerce(interpolate(w, valor ?? ""), schemaAt(endpoint.body?.schema, campo!)));
  }
  if (body && opts.mutate) opts.mutate(body);

  const headers: Record<string, string> = { accept: "application/json", ...w.headers };
  if (body !== undefined) headers["content-type"] = endpoint.body?.contentType ?? "application/json";

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: endpoint.method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(w.timeoutMs),
    });
  } catch (e) {
    throw new Error(`${endpoint.method} ${url} não respondeu: ${(e as Error).cause ?? (e as Error).message}`);
  }
  const texto = await res.text();
  let responseBody: unknown = texto;
  if (texto && /json/i.test(res.headers.get("content-type") ?? "")) {
    try {
      responseBody = JSON.parse(texto);
    } catch {
      /* JSON quebrado: fica o texto, o contrato acusa */
    }
  }

  const ex: Exchange = {
    endpoint,
    method: endpoint.method,
    url,
    requestHeaders: headers,
    ...(body !== undefined ? { requestBody: body } : {}),
    status: res.status,
    responseHeaders: Object.fromEntries(res.headers.entries()),
    responseBody: texto ? responseBody : undefined,
    durationMs: Date.now() - t0,
    ...(opts.label ? { label: opts.label } : {}),
  };
  w.exchanges.push(ex);
  w.last = ex;

  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body)) {
      if (isSensitiveField(k) && typeof v === "string") w.secrets.add(v);
      w.data[k] = isSensitiveField(k) ? "••••••" : typeof v === "string" ? v : JSON.stringify(v);
    }
  }
  w.logger.info(`    → ${endpoint.method} ${caminho}${query} ${res.status} (${ex.durationMs} ms)${opts.label ? ` — ${opts.label}` : ""}`);
  return ex;
}
