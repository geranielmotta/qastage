import type { Knex } from "knex";
import { hashSenha, validarEmail, validarSenha } from "../auth/senha";
import { db } from "./conexao";

export type Papel = "admin" | "qa";

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  /** Projetos atribuídos pelo admin (ids). Admin vê todos, independentemente desta lista. */
  projetos: string[];
  ativo: boolean;
  senhaHash: string;
  criadoEm: string;
}

/** O que sai pela API: nunca o hash. */
export type UsuarioPublico = Omit<Usuario, "senhaHash">;
export const publico = ({ senhaHash: _, ...u }: Usuario): UsuarioPublico => u;

interface Linha {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  ativo: boolean;
  senha_hash: string;
  criado_em: Date;
  projetos: string[] | null;
}

/** Usuário + projetos numa consulta só (array_agg dos projetos atribuídos). */
function consulta(k: Knex | Knex.Transaction = db()) {
  return k("usuarios as u")
    .leftJoin("usuario_projetos as up", "up.usuario_id", "u.id")
    .groupBy("u.id")
    .select("u.*", k.raw("coalesce(array_agg(up.projeto_id order by up.projeto_id) filter (where up.projeto_id is not null), '{}') as projetos"));
}

const paraUsuario = (l: Linha): Usuario => ({
  id: l.id,
  nome: l.nome,
  email: l.email,
  papel: l.papel,
  projetos: l.projetos ?? [],
  ativo: l.ativo,
  senhaHash: l.senha_hash,
  criadoEm: new Date(l.criado_em).toISOString(),
});

export async function listarUsuarios(): Promise<Usuario[]> {
  return ((await consulta().orderBy("u.criado_em")) as Linha[]).map(paraUsuario);
}

export async function contarUsuarios(): Promise<number> {
  const [{ n }] = (await db()("usuarios").count({ n: "*" })) as Array<{ n: string }>;
  return Number(n);
}

export async function buscarPorEmail(email: string): Promise<Usuario | undefined> {
  const l = (await consulta().where("u.email", email.trim().toLowerCase()).first()) as Linha | undefined;
  return l && paraUsuario(l);
}

export async function buscarPorId(id: string, k: Knex | Knex.Transaction = db()): Promise<Usuario | undefined> {
  const l = (await consulta(k).where("u.id", id).first()) as Linha | undefined;
  return l && paraUsuario(l);
}

function validarPapel(p: unknown): Papel {
  if (p !== "admin" && p !== "qa") throw new Error('Papel deve ser "admin" ou "qa".');
  return p;
}

function validarProjetos(ps: unknown): string[] {
  if (!Array.isArray(ps) || ps.some((p) => typeof p !== "string" || !p)) throw new Error("projetos deve ser uma lista de ids.");
  return [...new Set(ps as string[])];
}

export interface NovoUsuario {
  nome: string;
  email: string;
  papel: Papel;
  senha: string;
  projetos?: string[];
}

export async function criarUsuario(n: NovoUsuario): Promise<Usuario> {
  const nome = typeof n.nome === "string" ? n.nome.trim() : "";
  if (!nome) throw new Error("Informe o nome.");
  const email = validarEmail(n.email);
  const papel = validarPapel(n.papel);
  const senhaHash = hashSenha(validarSenha(n.senha));
  const projetos = validarProjetos(n.projetos ?? []);

  return db().transaction(async (trx) => {
    if (await trx("usuarios").where({ email }).first()) throw new Error(`Já existe usuário com o e-mail ${email}.`);
    const [{ id }] = await trx("usuarios").insert({ nome, email, papel, senha_hash: senhaHash }).returning("id");
    if (projetos.length) await trx("usuario_projetos").insert(projetos.map((projeto_id) => ({ usuario_id: id, projeto_id })));
    return (await buscarPorId(id, trx))!;
  });
}

export interface AlteracaoUsuario {
  nome?: string;
  papel?: Papel;
  ativo?: boolean;
  projetos?: string[];
  senha?: string;
}

/** Altera numa transação; se sobrar zero admin ativo, desfaz tudo. */
export async function alterarUsuario(id: string, a: AlteracaoUsuario): Promise<Usuario> {
  return db().transaction(async (trx) => {
    const atual = await trx("usuarios").where({ id }).forUpdate().first();
    if (!atual) throw new Error("Usuário não encontrado.");

    const campos: Record<string, unknown> = {};
    if (a.nome !== undefined) {
      if (typeof a.nome !== "string" || !a.nome.trim()) throw new Error("Informe o nome.");
      campos.nome = a.nome.trim();
    }
    if (a.papel !== undefined) campos.papel = validarPapel(a.papel);
    if (a.ativo !== undefined) campos.ativo = !!a.ativo;
    if (a.senha !== undefined) campos.senha_hash = hashSenha(validarSenha(a.senha));
    if (Object.keys(campos).length) await trx("usuarios").where({ id }).update({ ...campos, atualizado_em: trx.fn.now() });

    if (a.projetos !== undefined) {
      const projetos = validarProjetos(a.projetos);
      await trx("usuario_projetos").where({ usuario_id: id }).whereNotIn("projeto_id", projetos).delete();
      if (projetos.length) {
        await trx("usuario_projetos")
          .insert(projetos.map((projeto_id) => ({ usuario_id: id, projeto_id })))
          .onConflict(["usuario_id", "projeto_id"])
          .ignore();
      }
    }

    // Nunca deixar o sistema sem um admin ativo (senão ninguém mais administra).
    const [{ n }] = (await trx("usuarios").where({ papel: "admin", ativo: true }).count({ n: "*" })) as Array<{ n: string }>;
    if (Number(n) === 0) throw new Error("Precisa existir ao menos um administrador ativo.");
    return (await buscarPorId(id, trx))!;
  });
}
