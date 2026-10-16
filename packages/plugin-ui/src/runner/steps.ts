import { CucumberExpression, ParameterTypeRegistry } from "@cucumber/cucumber-expressions";
import type { Logger } from "@qastage/core-contract";
import type { Page } from "playwright";
import type { ElementResolver, Intent, Resolution } from "./resolver";
import { screenKey } from "./text";

/** Estado de um cenário em execução, compartilhado pelos passos. */
export interface StepWorld {
  page: Page;
  baseUrl: string;
  resolver: ElementResolver;
  logger: Logger;
  /** Como cada rótulo foi resolvido — vira artefato da execução. */
  resolutions: Resolution[];
  /** Dados que o cenário usou (campo → valor) — vão para o pacote de falha. */
  data: Record<string, string>;
  /** Valores sensíveis já digitados: são trocados por "••••••" em tudo que sai da execução. */
  secrets: Set<string>;
  timeoutMs: number;
}

type StepFn = (world: StepWorld, ...args: string[]) => Promise<void>;

interface StepDefinition {
  pattern: string;
  expression: CucumberExpression;
  run: StepFn;
}

const registry = new ParameterTypeRegistry();
const definitions: StepDefinition[] = [];

function step(pattern: string, run: StepFn): void {
  definitions.push({ pattern, expression: new CucumberExpression(pattern, registry), run });
}

/** Campos cujo valor nunca vai para relatório/pacote de falha (que podem virar anexo no Jira). */
const SENSIVEL = /senha|password|passwd|token|secret|segredo|pin\b|cvv|api.?key/i;

function registrar(w: StepWorld, campo: string, valor: string): void {
  if (SENSIVEL.test(campo) && valor) {
    w.secrets.add(valor);
    w.data[campo] = "••••••";
  } else {
    w.data[campo] = valor;
  }
}

async function resolve(w: StepWorld, rotulo: string, intent: Intent) {
  const r = await w.resolver.resolve(w.page, rotulo, intent);
  w.resolutions.push(r);
  w.logger.info(`    "${rotulo}" → ${r.detail}`);
  return r.locator;
}

/** Repete a checagem até passar ou estourar o timeout (sem depender do @playwright/test). */
async function eventually(w: StepWorld, check: () => Promise<boolean>, falha: () => Promise<string>): Promise<void> {
  const limite = Date.now() + w.timeoutMs;
  while (!(await check())) {
    if (Date.now() >= limite) throw new Error(await falha());
    await w.page.waitForTimeout(200);
  }
}

function urlDe(baseUrl: string, caminho: string): string {
  if (/^https?:\/\//.test(caminho)) return caminho;
  return baseUrl.replace(/\/+$/, "") + "/" + caminho.replace(/^\/+/, "");
}

// ── Vocabulário fechado de passos de tela ────────────────────────────────────
// O "(que )" opcional deixa o mesmo passo servir em Dado/Quando/E.

step("(que )eu acesso {string}", async (w, caminho) => {
  await w.page.goto(urlDe(w.baseUrl, caminho!));
});

step("(que )eu preencho {string} com {string}", async (w, campo, valor) => {
  await (await resolve(w, campo!, "fill")).fill(valor!);
  registrar(w, campo!, valor!);
});

step("(que )eu clico em {string}", async (w, rotulo) => {
  await (await resolve(w, rotulo!, "click")).click();
});

step("(que )eu seleciono {string} em {string}", async (w, opcao, campo) => {
  await (await resolve(w, campo!, "select")).selectOption(opcao!);
  registrar(w, campo!, opcao!);
});

step("(que )eu marco {string}", async (w, rotulo) => {
  await (await resolve(w, rotulo!, "check")).check();
  w.data[rotulo!] = "marcado";
});

step("(que )eu desmarco {string}", async (w, rotulo) => {
  await (await resolve(w, rotulo!, "check")).uncheck();
  w.data[rotulo!] = "desmarcado";
});

step("eu devo ver {string}", async (w, texto) => {
  const alvo = w.page.getByText(texto!).filter({ visible: true });
  await eventually(w, async () => (await alvo.count()) > 0, async () => `Texto "${texto}" não apareceu na tela.`);
});

step("eu não devo ver {string}", async (w, texto) => {
  const alvo = w.page.getByText(texto!).filter({ visible: true });
  await eventually(w, async () => (await alvo.count()) === 0, async () => `Texto "${texto}" continua visível na tela.`);
});

step("o campo {string} deve conter {string}", async (w, campo, esperado) => {
  const el = await resolve(w, campo!, "fill");
  await eventually(
    w,
    async () => (await el.inputValue()) === esperado,
    async () => `Campo "${campo}": esperado "${esperado}", obtido "${await el.inputValue()}".`,
  );
});

step("eu devo estar em {string}", async (w, caminho) => {
  const alvo = screenKey(caminho!);
  await eventually(
    w,
    async () => screenKey(w.page.url()) === alvo,
    async () => `Esperava estar em "${caminho}", mas a tela é ${w.page.url()}.`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────

/** Troca valores sensíveis por "••••••" num texto (nome de passo, erro...). */
export function mask(texto: string, secrets: Set<string>): string {
  let out = texto;
  for (const s of secrets) out = out.split(s).join("••••••");
  return out;
}

/** Detecta, antes de executar, se o passo vai digitar um valor sensível. */
export function sensitiveValue(texto: string): string | undefined {
  const m = texto.match(/eu preencho "([^"]*)" com "([^"]*)"/);
  return m && SENSIVEL.test(m[1]!) && m[2] ? m[2] : undefined;
}

export interface MatchedStep {
  pattern: string;
  args: string[];
  run: StepFn;
}

/** Acha o passo do vocabulário que casa com o texto; erro claro se nenhum ou vários. */
export function matchStep(texto: string): MatchedStep {
  const achados = definitions
    .map((d) => ({ d, args: d.expression.match(texto) }))
    .filter((x) => x.args !== null);
  if (achados.length === 0) {
    throw new Error(`Passo não reconhecido: "${texto}".\nPassos disponíveis:\n${listSteps().map((p) => `  - ${p}`).join("\n")}`);
  }
  if (achados.length > 1) {
    throw new Error(`Passo ambíguo: "${texto}" casa com ${achados.map((x) => `"${x.d.pattern}"`).join(", ")}`);
  }
  const { d, args } = achados[0]!;
  return { pattern: d.pattern, args: args!.map((a) => String(a.getValue(null))), run: d.run };
}

export function listSteps(): string[] {
  return definitions.map((d) => d.pattern);
}
