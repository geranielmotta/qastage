import type { Knex } from "knex";

/**
 * Histórico de execuções (o que o dashboard e os relatórios consultam) e a
 * trilha de auditoria. Prints, traces e report.html continuam em arquivos;
 * aqui fica o resumo e onde encontrá-los.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("execucoes", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.text("projeto_id");
    t.text("plugin").notNullable();
    t.text("ambiente");
    t.text("status").notNullable();
    t.text("origem").notNullable().defaultTo("api");
    t.uuid("solicitado_por").references("id").inTable("usuarios").onDelete("SET NULL");
    t.text("solicitante_nome");
    t.timestamp("iniciada_em", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp("finalizada_em", { useTz: true });
    t.integer("duracao_ms");
    t.jsonb("contagens");
    /** Falhas resumidas: cenário, passo, erro, pasta do pacote e o card do Jira, se houver. */
    t.jsonb("falhas").notNullable().defaultTo("[]");
    t.jsonb("metricas");
    /** Pasta da execução relativa a artifacts/ (ex.: "portal/ui-testing/1792..."). */
    t.text("relatorio_id").unique();
    t.text("erro");
    t.jsonb("logs").notNullable().defaultTo("[]");
    t.check("?? in ('running', 'passed', 'failed', 'error', 'skipped')", ["status"], "execucoes_status_valido");
    t.check("?? in ('api', 'cli', 'importacao')", ["origem"], "execucoes_origem_valida");
    t.index(["projeto_id", "iniciada_em"]);
    t.index(["status"]);
  });

  await knex.schema.createTable("auditoria", (t) => {
    t.bigIncrements("id");
    t.timestamp("em", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid("usuario_id").references("id").inTable("usuarios").onDelete("SET NULL");
    t.text("usuario_email");
    t.text("acao").notNullable();
    t.text("alvo");
    t.jsonb("detalhes");
    t.text("ip");
    t.index(["em"]);
    t.index(["usuario_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("auditoria");
  await knex.schema.dropTable("execucoes");
}
