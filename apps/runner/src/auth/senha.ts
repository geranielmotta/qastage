import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Regras de senha e de e-mail, sem banco: usadas pelo repositório, pela CLI e pelas seeds. */
export const SENHA_MINIMA = 8;

export function hashSenha(senha: string): string {
  const sal = randomBytes(16);
  return `scrypt$${sal.toString("hex")}$${scryptSync(senha, sal, 64).toString("hex")}`;
}

export function confereSenha(senha: string, hash: string): boolean {
  const [alg, salHex, hashHex] = hash.split("$");
  if (alg !== "scrypt" || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, "hex");
  const obtido = scryptSync(senha, Buffer.from(salHex, "hex"), esperado.length);
  return timingSafeEqual(esperado, obtido);
}

/** Senha temporária legível (o admin repassa; a pessoa troca no primeiro acesso). */
export function senhaTemporaria(): string {
  return randomBytes(9).toString("base64url");
}

export function validarSenha(senha: unknown): string {
  if (typeof senha !== "string" || senha.length < SENHA_MINIMA) throw new Error(`A senha precisa ter ao menos ${SENHA_MINIMA} caracteres.`);
  return senha;
}

export function validarEmail(email: unknown): string {
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("E-mail inválido.");
  return e;
}
