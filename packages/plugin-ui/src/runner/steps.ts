import type { Logger } from "@qastage/core-contract";
import { isSensitiveField } from "@qastage/data";
import { StepLibrary } from "@qastage/feature";
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

/** Vocabulário de passos de tela. */
export const uiSteps = new StepLibrary<StepWorld>();
const step = (pattern: string, run: (w: StepWorld, ...args: string[]) => Promise<void>) =>
  uiSteps.step(pattern, (w, args) => run(w, ...args));


function registrar(w: StepWorld, campo: string, valor: string): void {
  if (isSensitiveField(campo) && valor) {
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

/** Detecta, antes de executar, se o passo vai digitar um valor sensível. */
export function sensitiveValue(texto: string): string | undefined {
  const m = texto.match(/eu preencho "([^"]*)" com "([^"]*)"/);
  return m && isSensitiveField(m[1]!) && m[2] ? m[2] : undefined;
}
