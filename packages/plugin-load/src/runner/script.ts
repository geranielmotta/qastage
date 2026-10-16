import { Rng } from "@qastage/data";
import { findEndpoint, generate } from "@qastage/plugin-api";
import type { LoadPlan } from "./plan";

/** Requisição do mix já resolvida contra o spec. */
export interface ResolvedEntry {
  ref: string;
  method: string;
  path: string;
  weight: number;
  /** Pool de corpos gerados (estrutura do schema + valores do módulo de dados). */
  bodies?: unknown[];
}

const LEITURA = new Set(["GET", "HEAD", "OPTIONS"]);
/** Corpos distintos por endpoint de escrita; cada iteração sorteia um. */
const POOL = 50;

/** Resolve o mix contra o spec: endpoint existe, caminho é concreto, escrita é permitida. */
export function resolveMix(plan: LoadPlan, writable: boolean, envName: string, seed: string): ResolvedEntry[] {
  if (!plan.spec) throw new Error('Nenhuma fonte de endpoints. Use: Dado que a API é descrita em "<link ou arquivo>"');
  return plan.mix.map((m) => {
    const { endpoint, pathParams } = findEndpoint(plan.spec!, m.ref);
    const path = endpoint.path.replace(/\{(\w+)\}/g, (_, n: string) => {
      const v = pathParams[n];
      if (v === undefined) throw new Error(`Na carga, use o caminho concreto: em vez de "${endpoint.id}", escreva por exemplo "${endpoint.method} ${endpoint.path.replace(`{${n}}`, "1")}".`);
      return encodeURIComponent(v);
    });
    if (!LEITURA.has(endpoint.method) && !writable) {
      throw new Error(`O ambiente "${envName}" não aceita escrita: ${m.ref} criaria registros de verdade durante a carga.`);
    }
    const query = m.ref.includes("?") ? "?" + m.ref.split("?")[1] : "";
    const entry: ResolvedEntry = { ref: m.ref, method: endpoint.method, path: path + query, weight: m.weight };
    if (endpoint.body?.schema) {
      const rng = new Rng(`${seed}:${m.ref}`);
      entry.bodies = Array.from({ length: POOL }, () => generate(endpoint.body!.schema, rng));
    }
    return entry;
  });
}

/** Métrica global só das requisições do mix (o login do setup fica de fora). */
const doMix = (metric: string) => (metric.includes("{") ? metric : `${metric}{qastage:mix}`);

/**
 * Gera o script k6. Segredos (corpo do login, token) NÃO entram no arquivo:
 * vão por variável de ambiente do k6 (-e), para o script poder ser guardado
 * como artefato sem vazar nada.
 */
export function renderScript(plan: LoadPlan, entries: ResolvedEntry[], loginPath?: string): string {
  const load = plan.load!;
  const carga =
    load.kind === "constant"
      ? { vus: load.vus, duration: load.duration }
      : {
          stages: [
            { duration: load.rampUp, target: load.vus },
            { duration: load.hold, target: load.vus },
            { duration: "10s", target: 0 },
          ],
        };

  const thresholds: Record<string, string[]> = {};
  for (const t of plan.thresholds) (thresholds[doMix(t.metric)] ??= []).push(t.expr);
  // Garante as submétricas por endpoint no resumo, mesmo sem limite para elas.
  for (const e of entries) {
    thresholds[`http_req_duration{endpoint:${e.ref}}`] ??= [];
    thresholds[`http_req_failed{endpoint:${e.ref}}`] ??= [];
  }
  thresholds["http_req_duration{qastage:mix}"] ??= [];
  thresholds["http_req_failed{qastage:mix}"] ??= [];
  thresholds["http_reqs{qastage:mix}"] ??= [];

  const options = { ...carga, thresholds, summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"] };

  return `// Gerado pelo QAStage (plugin load-testing). Não editar: é regerado a cada execução.
import http from "k6/http";
import { sleep } from "k6";

export const options = ${JSON.stringify(options, null, 2)};

const BASE = __ENV.QASTAGE_BASE_URL;
const THINK = ${plan.thinkTime};
const MIX = ${JSON.stringify(entries)};
const TOTAL = MIX.reduce((s, e) => s + e.weight, 0);

export function setup() {
  ${
    loginPath
      ? `const r = http.post(BASE + ${JSON.stringify(loginPath)}, __ENV.QASTAGE_LOGIN_BODY, {
    headers: { "content-type": "application/json" },
    tags: { endpoint: "login" },
  });
  if (r.status < 200 || r.status >= 300) throw new Error("Login falhou: " + r.status + " " + String(r.body).slice(0, 200));
  const b = r.json() || {};
  const token = b.accessToken || b.access_token || b.token || b.jwt || b.id_token;
  if (!token) throw new Error("Login sem token na resposta");
  return { token };`
      : `return { token: __ENV.QASTAGE_TOKEN || "" };`
  }
}

function sortear() {
  let n = Math.random() * TOTAL;
  for (const e of MIX) {
    n -= e.weight;
    if (n <= 0) return e;
  }
  return MIX[MIX.length - 1];
}

export default function (data) {
  const e = sortear();
  const headers = { accept: "application/json" };
  if (data.token) headers.authorization = "Bearer " + data.token;
  let body = null;
  if (e.bodies) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(e.bodies[Math.floor(Math.random() * e.bodies.length)]);
  }
  http.request(e.method, BASE + e.path, body, { headers, tags: { endpoint: e.ref, qastage: "mix" } });
  if (THINK > 0) sleep(THINK);
}

export function handleSummary(data) {
  // setup_data traz o token do login: nunca vai para o arquivo.
  delete data.setup_data;
  return { [__ENV.QASTAGE_SUMMARY]: JSON.stringify(data, null, 2) };
}
`;
}
