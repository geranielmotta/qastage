import { isSensitiveField } from "@qastage/data";
import { StepLibrary } from "@qastage/feature";
import { deletePath, getPath, requiredFields, topLevelFields, wrongTypeFor } from "./body";
import { interpolate, send } from "./http";
import { validateAgainst } from "./schema";
import { findEndpoint, loadSpec } from "./spec/load";
import type { ApiWorld, Exchange } from "./world";
import { SkipStep } from "./world";

/** Vocabulário de passos de API. */
export const apiSteps = new StepLibrary<ApiWorld>();
const step = apiSteps.step.bind(apiSteps);

const resumo = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s === undefined ? "(vazio)" : s.length > 400 ? s.slice(0, 400) + "…" : s;
};

function ultima(w: ApiWorld): Exchange {
  if (!w.last) throw new Error("Nenhuma requisição foi enviada ainda neste cenário.");
  return w.last;
}

/** "201" casa só 201; "2xx" casa 200–299. */
function statusCasa(status: number, esperado: string): boolean {
  const e = esperado.trim().toLowerCase();
  return /^\dxx$/.test(e) ? Math.floor(status / 100) === Number(e[0]) : status === Number(e);
}

// ── Fonte e autenticação ────────────────────────────────────────────────────

step("(que )a API é descrita em {string}", async (w, [fonte]) => {
  w.spec = await loadSpec(interpolate(w, fonte!));
  w.logger.info(`    spec: ${w.spec.title} (${w.spec.kind}, ${w.spec.endpoints.length} endpoints)`);
});

step("(que )eu uso o token {string}", async (w, [token]) => {
  const t = interpolate(w, token!);
  w.secrets.add(t);
  w.headers.authorization = `Bearer ${t}`;
});

step("(que )eu faço login em {string} com:", async (w, [ref], table) => {
  const corpo: Record<string, unknown> = {};
  for (const [campo, valor] of table ?? []) {
    const v = interpolate(w, valor ?? "");
    if (isSensitiveField(campo!)) w.secrets.add(v);
    corpo[campo!] = v;
  }
  const ex = await send(w, ref!, { rawBody: corpo, label: "login", readOnlyIntent: true });
  if (ex.status < 200 || ex.status >= 300) throw new Error(`Login falhou: ${ex.method} ${ex.url} → ${ex.status} ${resumo(ex.responseBody)}`);
  const b = (ex.responseBody ?? {}) as Record<string, unknown>;
  const token = [b.accessToken, b.access_token, b.token, b.jwt, b.id_token, (b.data as Record<string, unknown> | undefined)?.token].find(
    (x): x is string => typeof x === "string",
  );
  if (!token) throw new Error(`Login respondeu ${ex.status}, mas não achei o token (accessToken, access_token, token, jwt) em: ${resumo(b)}`);
  w.secrets.add(token);
  w.headers.authorization = `Bearer ${token}`;
});

step("(que )eu não estou autenticado", async (w) => {
  delete w.headers.authorization;
});

// ── Envio ───────────────────────────────────────────────────────────────────

step("eu envio {string}", async (w, [ref]) => {
  await send(w, ref!);
});

step("eu envio {string} com:", async (w, [ref], table) => {
  await send(w, ref!, { overrides: table ?? [] });
});

step("eu envio {string} sem o campo {string}", async (w, [ref, campo]) => {
  await send(w, ref!, { mutate: (b) => void deletePath(b, campo!), label: `sem o campo ${campo}` });
});

step("eu envio {string} com o campo {string} de tipo errado", async (w, [ref, campo]) => {
  const { endpoint } = findEndpoint(w.spec!, interpolate(w, ref!));
  const schema = topLevelFields(endpoint.body?.schema).find(([n]) => n === campo)?.[1];
  await send(w, ref!, { mutate: (b) => void (b[campo!] = wrongTypeFor(schema, b[campo!])), label: `${campo} com tipo errado` });
});

// ── Verificações ────────────────────────────────────────────────────────────

step("a resposta deve ter status {word}", async (w, [esperado]) => {
  const ex = ultima(w);
  if (!statusCasa(ex.status, esperado!)) {
    throw new Error(`${ex.method} ${ex.url}: esperado status ${esperado}, veio ${ex.status}.\nResposta: ${resumo(ex.responseBody)}`);
  }
});

step("a resposta deve seguir o contrato", async (w) => {
  const ex = ultima(w);
  const docs = ex.endpoint.responses;
  if (!Object.keys(docs).length) throw new SkipStep(`${ex.endpoint.id} não tem respostas documentadas na fonte (ex.: Postman): contrato não verificável.`);
  const chave = [String(ex.status), `${String(ex.status)[0]}XX`, "DEFAULT"].find((k) => k in docs);
  if (!chave) {
    throw new Error(`Quebra de contrato: ${ex.endpoint.id} respondeu ${ex.status}, que não está documentado (documentados: ${Object.keys(docs).join(", ")}).`);
  }
  const schema = docs[chave]!.schema;
  if (!schema) {
    if (ex.responseBody !== undefined && ex.responseBody !== "") throw new Error(`Quebra de contrato: ${ex.status} não deveria ter corpo, veio ${resumo(ex.responseBody)}`);
    return;
  }
  const erros = validateAgainst(schema, ex.responseBody);
  if (erros.length) throw new Error(`Quebra de contrato em ${ex.endpoint.id} (${ex.status}):\n${erros.map((e) => `  - ${e}`).join("\n")}`);
});

step("o campo {string} da resposta deve ser {string}", async (w, [campo, esperado]) => {
  const ex = ultima(w);
  const v = getPath(ex.responseBody, campo!);
  const alvo = interpolate(w, esperado!);
  if (String(v) !== alvo) throw new Error(`Campo "${campo}": esperado "${alvo}", veio ${resumo(v)}.`);
});

step("o campo {string} da resposta deve existir", async (w, [campo]) => {
  if (getPath(ultima(w).responseBody, campo!) === undefined) throw new Error(`Campo "${campo}" ausente na resposta: ${resumo(ultima(w).responseBody)}`);
});

step("eu guardo o campo {string} da resposta como {string}", async (w, [campo, nome]) => {
  const v = getPath(ultima(w).responseBody, campo!);
  if (v === undefined) throw new Error(`Não há "${campo}" na resposta para guardar: ${resumo(ultima(w).responseBody)}`);
  w.vars[nome!] = v;
});

// ── Negativos em lote ───────────────────────────────────────────────────────

/** Roda uma variação por campo e exige 4xx de cada; falha listando as que passaram. */
async function negativos(w: ApiWorld, ref: string, casos: Array<{ label: string; mutate: (b: Record<string, unknown>) => void }>) {
  if (!casos.length) throw new SkipStep(`${ref}: nenhum campo para testar.`);
  const aceitos: string[] = [];
  for (const c of casos) {
    const ex = await send(w, ref, { mutate: c.mutate, label: c.label });
    if (ex.status < 400 || ex.status >= 500) aceitos.push(`${c.label} → ${ex.status}${ex.status < 300 ? " (aceitou e criou o registro)" : ""}`);
  }
  if (aceitos.length) {
    throw new Error(`${ref}: ${aceitos.length} de ${casos.length} variações inválidas não foram recusadas com 4xx:\n${aceitos.map((a) => `  - ${a}`).join("\n")}`);
  }
}

step("os campos obrigatórios de {string} devem ser exigidos", async (w, [ref]) => {
  const { endpoint } = findEndpoint(w.spec!, interpolate(w, ref!));
  await negativos(
    w,
    ref!,
    requiredFields(endpoint.body?.schema).map((campo) => ({ label: `sem o campo ${campo}`, mutate: (b) => void delete b[campo] })),
  );
});

step("os tipos dos campos de {string} devem ser validados", async (w, [ref]) => {
  const { endpoint } = findEndpoint(w.spec!, interpolate(w, ref!));
  await negativos(
    w,
    ref!,
    topLevelFields(endpoint.body?.schema)
      .filter(([, s]) => s.type)
      .map(([campo, s]) => ({ label: `${campo} com tipo errado`, mutate: (b) => void (b[campo] = wrongTypeFor(s, b[campo])) })),
  );
});
