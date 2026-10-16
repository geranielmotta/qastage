import { join } from "node:path";
import type { Locator, Page } from "playwright";
import { EXCEPTIONS_FILE, type ManualLocator, type MapStore } from "./screen-map";
import { normalizeLabel, screenKey, slugify } from "./text";

/** O que o passo quer fazer com o elemento — muda quais papéis semânticos valem. */
export type Intent = "fill" | "click" | "select" | "check" | "any";

export type Strategy = "manual" | "testid" | "testid-mapa" | "semantico";

export interface Resolution {
  rotulo: string;
  screen: string;
  strategy: Strategy;
  /** Como o elemento foi achado, legível (ex.: `data-testid="e-mail"`). */
  detail: string;
  locator: Locator;
}

interface Candidate {
  strategy: Strategy;
  detail: string;
  locator: Locator;
}

/**
 * Resolve um rótulo humano ("E-mail", "Entrar") para um elemento da tela, sem
 * LLM. Ordem da cadeia, parando no primeiro acerto único e visível:
 *
 *   0. exceção manual do QA (exceptions.json) — se existe, é a única usada:
 *      o QA foi explícito, então nunca caímos em silêncio para outro elemento;
 *   1. data-testid = slug do rótulo (a convenção com o dev);
 *   2. data-testid achado pelo mapa do scan (rótulo → testid, quando o slug não bate);
 *   3. semântico: role/label/placeholder/texto, conforme a intenção do passo.
 *
 * Nada achado → erro com o trecho pronto para colar no exceptions.json.
 */
export class ElementResolver {
  constructor(
    private readonly store: MapStore,
    private readonly testIdAttribute: string,
    private readonly timeoutMs = 5000,
  ) {}

  async resolve(page: Page, rotulo: string, intent: Intent): Promise<Resolution> {
    const screen = screenKey(page.url());
    const candidatos = this.candidates(page, screen, rotulo, intent);
    const limite = Date.now() + this.timeoutMs;

    // Telas carregam aos poucos: repetimos a cadeia até o timeout.
    for (;;) {
      let ambiguo: Candidate | undefined;
      for (const c of candidatos) {
        const n = await c.locator.count();
        if (n === 1) return { rotulo, screen, strategy: c.strategy, detail: c.detail, locator: c.locator };
        if (n > 1 && !ambiguo) ambiguo = c;
      }
      if (ambiguo) {
        return {
          rotulo,
          screen,
          strategy: ambiguo.strategy,
          detail: `${ambiguo.detail} (ambíguo: usando o primeiro)`,
          locator: ambiguo.locator.first(),
        };
      }
      if (Date.now() >= limite) break;
      await page.waitForTimeout(200);
    }

    const tentados = candidatos.map((c) => `  - ${c.detail}`).join("\n");
    const exemplo = JSON.stringify({ [screen]: { [rotulo]: { css: "<seletor css>" } } }, null, 2);
    throw new Error(
      `Não encontrei "${rotulo}" na tela "${screen}". Tentei:\n${tentados}\n` +
        `Para seguir sem esperar o dev, adicione em ${join(this.store.dir, EXCEPTIONS_FILE)}:\n${exemplo}\n` +
        `(chaves aceitas: css, testid, text, xpath; use "*" no lugar da tela para valer em todas)`,
    );
  }

  private candidates(page: Page, screen: string, rotulo: string, intent: Intent): Candidate[] {
    const visivel = (l: Locator) => l.filter({ visible: true });
    const attr = this.testIdAttribute;
    const porTestid = (id: string) => visivel(page.locator(`[${attr}=${JSON.stringify(id)}]`));

    const manual = this.store.getException(screen, rotulo, normalizeLabel);
    if (manual) return [manualCandidate(page, manual, attr, visivel)];

    const out: Candidate[] = [];
    const slug = slugify(rotulo);
    if (slug) out.push({ strategy: "testid", detail: `${attr}="${slug}"`, locator: porTestid(slug) });

    const alvo = normalizeLabel(rotulo);
    for (const el of this.store.getMap(screen)?.elements ?? []) {
      if (el.testid && el.testid !== slug && el.label && normalizeLabel(el.label) === alvo) {
        out.push({ strategy: "testid-mapa", detail: `${attr}="${el.testid}" (pelo mapa da tela)`, locator: porTestid(el.testid) });
      }
    }

    const sem = (detail: string, locator: Locator) => out.push({ strategy: "semantico", detail, locator: visivel(locator) });
    const exato = { name: rotulo, exact: true };
    const porRole = (role: Parameters<Page["getByRole"]>[0]) => sem(`role=${role}[name="${rotulo}"]`, page.getByRole(role, exato));

    if (intent === "fill" || intent === "select" || intent === "check" || intent === "any") {
      sem(`label="${rotulo}"`, page.getByLabel(rotulo, { exact: true }));
    }
    if (intent === "fill" || intent === "any") {
      sem(`placeholder="${rotulo}"`, page.getByPlaceholder(rotulo, { exact: true }));
      porRole("textbox");
    }
    if (intent === "select") porRole("combobox");
    if (intent === "check") {
      porRole("checkbox");
      porRole("radio");
    }
    if (intent === "click" || intent === "any") {
      for (const role of ["button", "link", "tab", "menuitem"] as const) porRole(role);
      sem(`texto="${rotulo}"`, page.getByText(rotulo, { exact: true }));
    }
    // Por último, as variantes "contém": cobrem "Senha *", "E-mail:" e afins.
    if (intent !== "click") sem(`label~="${rotulo}"`, page.getByLabel(rotulo));
    if (intent === "click" || intent === "any") sem(`texto~="${rotulo}"`, page.getByText(rotulo));
    return out;
  }
}

function manualCandidate(page: Page, m: ManualLocator, attr: string, visivel: (l: Locator) => Locator): Candidate {
  if (m.testid) return { strategy: "manual", detail: `manual: ${attr}="${m.testid}"`, locator: visivel(page.locator(`[${attr}=${JSON.stringify(m.testid)}]`)) };
  if (m.css) return { strategy: "manual", detail: `manual: css=${m.css}`, locator: visivel(page.locator(m.css)) };
  if (m.xpath) return { strategy: "manual", detail: `manual: xpath=${m.xpath}`, locator: visivel(page.locator(`xpath=${m.xpath}`)) };
  if (m.text) return { strategy: "manual", detail: `manual: texto="${m.text}"`, locator: visivel(page.getByText(m.text, { exact: true })) };
  throw new Error(`Exceção manual sem localizador (use css, testid, text ou xpath): ${JSON.stringify(m)}`);
}
