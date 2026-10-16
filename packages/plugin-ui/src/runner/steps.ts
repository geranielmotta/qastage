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
});

step("(que )eu clico em {string}", async (w, rotulo) => {
  await (await resolve(w, rotulo!, "click")).click();
});

step("(que )eu seleciono {string} em {string}", async (w, opcao, campo) => {
  await (await resolve(w, campo!, "select")).selectOption(opcao!);
});

step("(que )eu marco {string}", async (w, rotulo) => {
  await (await resolve(w, rotulo!, "check")).check();
});

step("(que )eu desmarco {string}", async (w, rotulo) => {
  await (await resolve(w, rotulo!, "check")).uncheck();
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
