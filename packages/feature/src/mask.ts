/** Troca valores sensíveis por "••••••" num texto (nome de passo, erro, log...). */
export function mask(texto: string, secrets: Iterable<string>): string {
  let out = texto;
  for (const s of secrets) if (s) out = out.split(s).join("••••••");
  return out;
}
