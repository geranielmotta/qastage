import { createHash, randomBytes } from "node:crypto";
import { db } from "./conexao";
import { buscarPorId, type Usuario } from "./usuarios";

export const DURACAO_MS = 12 * 60 * 60 * 1000;

/** O banco guarda só o SHA-256 do token: um dump não dá sessões utilizáveis. */
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function abrirSessao(usuarioId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db()("sessoes").insert({ token_hash: hash(token), usuario_id: usuarioId, expira_em: new Date(Date.now() + DURACAO_MS) });
  return token;
}

export async function fecharSessao(token: string | undefined): Promise<void> {
  if (token) await db()("sessoes").where({ token_hash: hash(token) }).delete();
}

/** Fecha as sessões de um usuário (desativado, papel alterado, senha redefinida), exceto a atual. */
export async function fecharSessoesDe(usuarioId: string, excetoToken?: string): Promise<void> {
  const q = db()("sessoes").where({ usuario_id: usuarioId });
  if (excetoToken) q.whereNot({ token_hash: hash(excetoToken) });
  await q.delete();
}

/** Usuário da sessão: só se a sessão vale e o usuário segue ativo. */
export async function usuarioDaSessao(token: string | undefined): Promise<Usuario | undefined> {
  if (!token) return undefined;
  const s = await db()("sessoes").where({ token_hash: hash(token) }).andWhere("expira_em", ">", new Date()).first();
  if (!s) return undefined;
  const u = await buscarPorId(s.usuario_id);
  return u?.ativo ? u : undefined;
}

export async function limparSessoesExpiradas(): Promise<number> {
  return db()("sessoes").where("expira_em", "<", new Date()).delete();
}
