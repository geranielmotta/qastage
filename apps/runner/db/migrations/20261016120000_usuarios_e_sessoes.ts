import type { Knex } from "knex";

/** Contas (admin/qa), projetos atribuídos a cada QA e sessões de login. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("usuarios", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.text("nome").notNullable();
    t.text("email").notNullable().unique();
    t.text("papel").notNullable();
    t.boolean("ativo").notNullable().defaultTo(true);
    t.text("senha_hash").notNullable();
    t.timestamp("criado_em", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp("atualizado_em", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check("?? in ('admin', 'qa')", ["papel"], "usuarios_papel_valido");
    t.check("?? = lower(??)", ["email", "email"], "usuarios_email_minusculo");
  });

  // Atribuição feita pelo admin: quais projetos cada QA testa.
  await knex.schema.createTable("usuario_projetos", (t) => {
    t.uuid("usuario_id").notNullable().references("id").inTable("usuarios").onDelete("CASCADE");
    t.text("projeto_id").notNullable();
    t.timestamp("atribuido_em", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(["usuario_id", "projeto_id"]);
    t.index(["projeto_id"]);
  });

  // Guardamos só o hash do token: quem ler o banco não consegue usar a sessão.
  await knex.schema.createTable("sessoes", (t) => {
    t.text("token_hash").primary();
    t.uuid("usuario_id").notNullable().references("id").inTable("usuarios").onDelete("CASCADE");
    t.timestamp("criada_em", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp("expira_em", { useTz: true }).notNullable();
    t.index(["usuario_id"]);
    t.index(["expira_em"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("sessoes");
  await knex.schema.dropTable("usuario_projetos");
  await knex.schema.dropTable("usuarios");
}
