import type { Page } from "playwright";
import type { ScannedElement, ScreenMap } from "./screen-map";
import { screenKey, slugify } from "./text";

interface RawElement {
  testid: string | null;
  tag: string;
  role: string | null;
  label: string | null;
}

/** Roda dentro da página: coleta elementos com testid e interativos, com o rótulo inferido. */
const COLETOR = String.raw`function (attr) {
  const interativos =
    "input:not([type=hidden]), select, textarea, button, a[href], [role=button], [role=link]," +
    " [role=checkbox], [role=textbox], [role=combobox], [contenteditable=true], [onclick]";

  function texto(s) { return (s || "").replace(/\s+/g, " ").trim() || null; }

  function rotulo(el) {
    const aria = texto(el.getAttribute("aria-label"));
    if (aria) return aria;
    const ids = el.getAttribute("aria-labelledby");
    if (ids) {
      const t = texto(ids.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || "").join(" "));
      if (t) return t;
    }
    if (el.labels && el.labels.length > 0) return texto(el.labels[0].textContent);
    return (
      texto(el.getAttribute("placeholder")) ||
      texto(el.getAttribute("title")) ||
      texto(el.getAttribute("alt")) ||
      (el instanceof HTMLInputElement && ["button", "submit"].includes(el.type) ? texto(el.value) : null) ||
      texto(el.innerText)
    );
  }

  const out = [];
  for (const el of new Set(document.querySelectorAll("[" + attr + "], " + interativos))) {
    out.push({ testid: el.getAttribute(attr), tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), label: rotulo(el) });
  }
  return out;
}`;

/**
 * Lê o DOM da tela aberta e monta o mapa: todos os elementos com testid e, à
 * parte, os elementos interativos que ficaram sem — com o testid sugerido pela
 * convenção (slug do rótulo), pronto para o dev aplicar.
 */
export async function scanPage(page: Page, testIdAttribute: string): Promise<ScreenMap> {
  // Enviado como texto: funções transpiladas (tsx/esbuild) levam helpers como
  // __name que não existem dentro da página.
  const raw = (await page.evaluate(`(${COLETOR})(${JSON.stringify(testIdAttribute)})`)) as RawElement[];

  const elements: ScannedElement[] = [];
  const missingTestid: ScannedElement[] = [];
  for (const r of raw) {
    const base: ScannedElement = { tag: r.tag };
    if (r.role) base.role = r.role;
    if (r.label) base.label = r.label;
    if (r.testid) {
      elements.push({ testid: r.testid, ...base });
    } else {
      const sugerido = r.label ? slugify(r.label) : "";
      missingTestid.push(sugerido ? { ...base, suggestedTestid: sugerido } : base);
    }
  }

  return {
    screen: screenKey(page.url()),
    url: page.url(),
    scannedAt: new Date().toISOString(),
    testIdAttribute,
    elements,
    missingTestid,
  };
}
