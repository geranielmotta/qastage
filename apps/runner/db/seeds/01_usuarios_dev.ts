import type { Knex } from "knex";
import { hashSenha } from "../../src/auth/senha";

/**
 * Usuários de desenvolvimento (idempotente: roda de novo sem duplicar).
 *   admin@qastage.local  — admin
 *   qa@qastage.local     — QA com os projetos de demonstração
 * Senha: QASTAGE_SEED_SENHA (padrão "qastage123"). Recusa rodar em produção.
 */
export async function seed(knex: Knex): Promise<void> {
  if (process.env.NODE_ENV === "production" && process.env.QASTAGE_SEED_FORCAR !== "true") {
    throw new Error("Seeds de desenvolvimento não rodam em produção (defina QASTAGE_SEED_FORCAR=true se for intencional).");
  }
  const senha = process.env.QASTAGE_SEED_SENHA ?? "qastage123";
  const pessoas = [
    { nome: "Admin (dev)", email: "admin@qastage.local", papel: "admin", projetos: [] as string[] },
    { nome: "QA (dev)", email: "qa@qastage.local", papel: "qa", projetos: ["portal-demo", "api-clientes"] },
  ];
  for (const p of pessoas) {
    const [u] = await knex("usuarios")
      .insert({ nome: p.nome, email: p.email, papel: p.papel, senha_hash: hashSenha(senha) })
      .onConflict("email")
      .merge({ nome: p.nome, papel: p.papel, ativo: true, atualizado_em: knex.fn.now() })
      .returning("id");
    for (const projeto of p.projetos) {
      await knex("usuario_projetos").insert({ usuario_id: u.id, projeto_id: projeto }).onConflict(["usuario_id", "projeto_id"]).ignore();
    }
  }
}
