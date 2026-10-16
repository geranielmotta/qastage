/**
 * Convenção com o dev: o data-testid é o slug do rótulo visível.
 * "Finalizar pedido" → "finalizar-pedido", "E-mail" → "e-mail".
 */
export function slugify(rotulo: string): string {
  return rotulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Normaliza um rótulo para comparação: sem acento, caixa, espaços extras, ":" ou "*" no fim. */
export function normalizeLabel(rotulo: string): string {
  return rotulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s:*]+$/g, "")
    .trim();
}

/** Chave da tela a partir do caminho da URL: "/login" → "login", "/" → "home". */
export function screenKey(urlOrPath: string): string {
  const path = urlOrPath.startsWith("http") ? new URL(urlOrPath).pathname : urlOrPath.split(/[?#]/)[0]!;
  return slugify(path) || "home";
}
