import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { buscarPorId, type Usuario } from "./users";

export const COOKIE = "qastage_sessao";
export const DURACAO_MS = 12 * 60 * 60 * 1000;

interface Sessao {
  usuarioId: string;
  expira: number;
}

/** Sessões em memória: reiniciar o runner desloga todos (aceitável no POC). */
const sessoes = new Map<string, Sessao>();

export function abrirSessao(usuarioId: string): string {
  const token = randomBytes(32).toString("base64url");
  sessoes.set(token, { usuarioId, expira: Date.now() + DURACAO_MS });
  return token;
}

export function fecharSessao(token: string | undefined): void {
  if (token) sessoes.delete(token);
}

/** Fecha todas as sessões de um usuário (desativado, papel alterado, senha redefinida). */
export function fecharSessoesDe(usuarioId: string, exceto?: string): void {
  for (const [t, s] of sessoes) if (s.usuarioId === usuarioId && t !== exceto) sessoes.delete(t);
}

export function tokenDaRequisicao(req: IncomingMessage): string | undefined {
  const cookies = req.headers.cookie ?? "";
  for (const parte of cookies.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** Usuário da sessão: só se a sessão vale e o usuário segue ativo (relido do disco a cada pedido). */
export function usuarioDaRequisicao(req: IncomingMessage): Usuario | undefined {
  const token = tokenDaRequisicao(req);
  const s = token ? sessoes.get(token) : undefined;
  if (!s) return undefined;
  if (s.expira < Date.now()) {
    sessoes.delete(token!);
    return undefined;
  }
  const u = buscarPorId(s.usuarioId);
  return u?.ativo ? u : undefined;
}

export function cookieDeSessao(token: string): string {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DURACAO_MS / 1000}`;
}

export const cookieApagado = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

// ── Limite de tentativas de login ───────────────────────────────────────────

const falhas = new Map<string, { n: number; ate: number }>();
const MAX_FALHAS = 5;
const BLOQUEIO_MS = 60 * 1000;

/** Segundos de bloqueio restantes para este login, ou 0. */
export function bloqueado(email: string): number {
  const f = falhas.get(email);
  if (!f || f.n < MAX_FALHAS) return 0;
  const resta = f.ate - Date.now();
  if (resta <= 0) {
    falhas.delete(email);
    return 0;
  }
  return Math.ceil(resta / 1000);
}

export function registrarFalha(email: string): void {
  const f = falhas.get(email) ?? { n: 0, ate: 0 };
  f.n += 1;
  if (f.n >= MAX_FALHAS) f.ate = Date.now() + BLOQUEIO_MS;
  falhas.set(email, f);
}

export const limparFalhas = (email: string) => falhas.delete(email);
