import { resolve } from "node:path";
import { StepLibrary } from "@qastage/feature";
import { loadSpec } from "@qastage/plugin-api";
import type { LoadPlan } from "./plan";

const DURACAO = /^\d+(ms|s|m|h)$/;

function duracao(v: string): string {
  const d = v.trim();
  if (!DURACAO.test(d)) throw new Error(`Duração inválida "${v}": use 30s, 2m, 1h.`);
  return d;
}

/** "1%" → 0.01; "0.5%" → 0.005 */
function percentual(v: string): number {
  const m = v.trim().match(/^(\d+(?:[.,]\d+)?)\s*%$/);
  if (!m) throw new Error(`Percentual inválido "${v}": use, por exemplo, "1%".`);
  return Number(m[1]!.replace(",", ".")) / 100;
}

/** Vocabulário de carga: cada passo preenche o plano; nada é enviado até o k6 rodar. */
export const loadSteps = new StepLibrary<LoadPlan>();
const step = (pattern: string, run: (p: LoadPlan, args: string[], table?: string[][]) => void | Promise<void>) =>
  loadSteps.step(pattern, async (p, args, table) => run(p, args, table));

step("(que )a API é descrita em {string}", async (p, [fonte]) => {
  p.spec = await loadSpec(/^https?:\/\//.test(fonte!) ? fonte! : resolve(p.baseDir, fonte!));
});

step("(que )eu faço login em {string} com:", (p, [ref], table) => {
  p.login = { ref: ref!, body: Object.fromEntries((table ?? []).map(([k, v]) => [k!, v ?? ""])) };
});

step("(que )eu uso o token {string}", (p, [token]) => {
  p.token = token!;
});

step("{int} usuários virtuais por {string}", (p, [vus, d]) => {
  p.load = { kind: "constant", vus: Number(vus), duration: duracao(d!) };
});

step("a carga sobe até {int} usuários em {string} e se mantém por {string}", (p, [vus, subida, platô]) => {
  p.load = { kind: "ramp", vus: Number(vus), rampUp: duracao(subida!), hold: duracao(platô!) };
});

step("cada usuário executa:", (p, _args, table) => {
  const linhas = (table ?? []).filter(([ref]) => ref && !/^endpoint$/i.test(ref.trim()));
  if (!linhas.length) throw new Error('Informe o mix numa tabela: | POST /clientes | 1 |  (endpoint e peso)');
  p.mix = linhas.map(([ref, peso]) => {
    const w = peso === undefined || peso.trim() === "" ? 1 : Number(peso);
    if (!Number.isFinite(w) || w <= 0) throw new Error(`Peso inválido para ${ref}: "${peso}"`);
    return { ref: ref!.trim(), weight: w };
  });
});

step("cada usuário espera {string} entre as requisições", (p, [d]) => {
  const v = duracao(d!);
  const n = Number(v.replace(/\D+$/, ""));
  p.thinkTime = v.endsWith("ms") ? n / 1000 : v.endsWith("m") ? n * 60 : v.endsWith("h") ? n * 3600 : n;
});

// ── Limites de aceite (thresholds) ──────────────────────────────────────────

for (const pct of ["95", "99"] as const) {
  step(`o p${pct} deve ser menor que {int} ms`, (p, [ms]) => {
    p.thresholds.push({ label: `p${pct} < ${ms} ms`, metric: "http_req_duration", expr: `p(${pct})<${ms}`, stat: `p(${pct})`, unit: "ms" });
  });
  step(`o p${pct} de {string} deve ser menor que {int} ms`, (p, [ref, ms]) => {
    p.thresholds.push({
      label: `p${pct} de ${ref} < ${ms} ms`,
      metric: `http_req_duration{endpoint:${ref}}`,
      expr: `p(${pct})<${ms}`,
      stat: `p(${pct})`,
      unit: "ms",
    });
  });
}

step("a taxa de erro deve ser menor que {string}", (p, [v]) => {
  p.thresholds.push({ label: `taxa de erro < ${v}`, metric: "http_req_failed", expr: `rate<${percentual(v!)}`, stat: "rate", unit: "%" });
});

step("a taxa de erro de {string} deve ser menor que {string}", (p, [ref, v]) => {
  p.thresholds.push({
    label: `taxa de erro de ${ref} < ${v}`,
    metric: `http_req_failed{endpoint:${ref}}`,
    expr: `rate<${percentual(v!)}`,
    stat: "rate",
    unit: "%",
  });
});

step("a vazão deve ser maior que {int} requisições por segundo", (p, [n]) => {
  p.thresholds.push({ label: `vazão > ${n} req/s`, metric: "http_reqs", expr: `rate>${n}`, stat: "rate", unit: "req/s" });
});
