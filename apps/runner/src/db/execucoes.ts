import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunReport } from "@qastage/reports";
import { db } from "./conexao";

type Status = "running" | "passed" | "failed" | "error" | "skipped";

export interface FalhaResumo {
  scenario: string;
  step: string;
  error: string;
  dir: string;
  jira?: { key: string; url: string; action: "created" | "commented" };
}

/** Linha do histórico como a API devolve (mesmo formato que o shell já usa). */
export interface ExecucaoResumo {
  id: string;
  /** Pasta do relatório relativa a artifacts/ (para montar /artifacts/<id>/report.html). */
  reportId?: string;
  plugin: string;
  project?: { id: string };
  env: { name: string };
  status: Status;
  startedAt: string;
  durationMs: number;
  counts: Record<string, number>;
  failures: FalhaResumo[];
  requestedBy?: string;
  origem: "api" | "cli" | "importacao";
}

export interface Inicio {
  projetoId?: string;
  plugin: string;
  ambiente?: string;
  origem: "api" | "cli";
  usuario?: { id: string; nome: string };
  solicitanteNome?: string;
}

export async function registrarInicio(i: Inicio): Promise<string> {
  const [{ id }] = await db()("execucoes")
    .insert({
      projeto_id: i.projetoId ?? null,
      plugin: i.plugin,
      ambiente: i.ambiente ?? null,
      status: "running",
      origem: i.origem,
      solicitado_por: i.usuario?.id ?? null,
      solicitante_nome: i.usuario?.nome ?? i.solicitanteNome ?? null,
    })
    .returning("id");
  return id as string;
}

/** Fecha a execução com o resumo do report.json (fonte de verdade dos detalhes). */
export async function registrarFim(
  id: string,
  dados: { status: Status; ambiente?: string; report?: RunReport; erro?: string; logs: unknown[] },
): Promise<void> {
  const r = dados.report;
  await db()("execucoes")
    .where({ id })
    .update({
      status: dados.status,
      ...(dados.ambiente ? { ambiente: dados.ambiente } : {}),
      finalizada_em: db().fn.now(),
      duracao_ms: r?.durationMs ?? null,
      contagens: r ? JSON.stringify(r.counts) : null,
      falhas: JSON.stringify(r ? r.failures.map((f) => ({ scenario: f.scenario, step: f.step, error: f.error, dir: f.dir })) : []),
      metricas: r?.metrics ? JSON.stringify(r.metrics) : null,
      relatorio_id: r?.id ?? null,
      erro: dados.erro ?? r?.error ?? null,
      logs: JSON.stringify(dados.logs),
    });
}

/** Depois das integrações (Jira): copia o card de cada falha (jira.json do pacote) para o banco. */
export async function registrarIntegracoes(id: string, artifactsRoot: string): Promise<void> {
  const linha = await db()("execucoes").where({ id }).first("relatorio_id", "falhas");
  if (!linha?.relatorio_id) return;
  const falhas = (linha.falhas as FalhaResumo[]).map((f) => {
    const file = join(artifactsRoot, linha.relatorio_id, f.dir, "jira.json");
    if (!existsSync(file)) return f;
    const j = JSON.parse(readFileSync(file, "utf8")) as FalhaResumo["jira"];
    return j ? { ...f, jira: { key: j.key, url: j.url, action: j.action } } : f;
  });
  await db()("execucoes").where({ id }).update({ falhas: JSON.stringify(falhas) });
}

/** Execuções que ficaram "running" quando o runner caiu: não vão terminar mais. */
export async function marcarInterrompidas(): Promise<number> {
  return db()("execucoes")
    .where({ status: "running" })
    .update({ status: "error", erro: "Interrompida: o runner foi reiniciado durante a execução.", finalizada_em: db().fn.now() });
}

interface Linha {
  id: string;
  projeto_id: string | null;
  plugin: string;
  ambiente: string | null;
  status: Status;
  origem: ExecucaoResumo["origem"];
  solicitante_nome: string | null;
  iniciada_em: Date;
  duracao_ms: number | null;
  contagens: Record<string, number> | null;
  falhas: FalhaResumo[];
  relatorio_id: string | null;
}

const resumo = (l: Linha): ExecucaoResumo => ({
  id: l.id,
  ...(l.relatorio_id ? { reportId: l.relatorio_id } : {}),
  plugin: l.plugin,
  ...(l.projeto_id ? { project: { id: l.projeto_id } } : {}),
  env: { name: l.ambiente ?? "" },
  status: l.status,
  startedAt: new Date(l.iniciada_em).toISOString(),
  durationMs: l.duracao_ms ?? 0,
  counts: l.contagens ?? { passed: 0, failed: 0, skipped: 0, error: 0 },
  failures: l.falhas ?? [],
  ...(l.solicitante_nome ? { requestedBy: l.solicitante_nome } : {}),
  origem: l.origem,
});

/** Histórico: de um projeto ou de vários (os visíveis ao usuário); undefined = todos (admin). */
export async function listarExecucoes(filtro: { projetos?: string[]; limite?: number }): Promise<ExecucaoResumo[]> {
  const q = db()("execucoes").orderBy("iniciada_em", "desc").limit(Math.min(filtro.limite ?? 100, 500));
  if (filtro.projetos) q.whereIn("projeto_id", filtro.projetos);
  return ((await q) as Linha[]).map(resumo);
}

/** As N últimas por projeto numa consulta só (dashboard). */
export async function ultimasPorProjeto(projetos: string[], n = 5): Promise<Map<string, ExecucaoResumo[]>> {
  const out = new Map<string, ExecucaoResumo[]>();
  if (!projetos.length) return out;
  const linhas = (await db()
    .select("*")
    .from(
      db()("execucoes")
        .select("*", db().raw("row_number() over (partition by projeto_id order by iniciada_em desc) as pos"))
        .whereIn("projeto_id", projetos)
        .as("t"),
    )
    .where("pos", "<=", n)
    .orderBy("iniciada_em", "desc")) as Linha[];
  for (const l of linhas) out.set(l.projeto_id!, [...(out.get(l.projeto_id!) ?? []), resumo(l)]);
  return out;
}

export async function obterExecucao(id: string): Promise<(ExecucaoResumo & { logs: unknown[]; erro?: string; reportUrl?: string }) | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const l = await db()("execucoes").where({ id }).first();
  if (!l) return undefined;
  return { ...resumo(l), logs: l.logs ?? [], ...(l.erro ? { erro: l.erro } : {}), ...(l.relatorio_id ? { reportUrl: `/artifacts/${l.relatorio_id}/report.html` } : {}) };
}

/** Importa report.json antigos (de antes do banco) — idempotente pelo relatorio_id. */
export async function importarRelatorio(r: RunReport): Promise<boolean> {
  const existe = await db()("execucoes").where({ relatorio_id: r.id }).first("id");
  if (existe) return false;
  await db()("execucoes").insert({
    projeto_id: r.project?.id ?? null,
    plugin: r.plugin,
    ambiente: r.env.name,
    status: r.status,
    origem: "importacao",
    solicitante_nome: r.requestedBy ?? null,
    iniciada_em: r.startedAt,
    finalizada_em: r.finishedAt,
    duracao_ms: r.durationMs,
    contagens: JSON.stringify(r.counts),
    falhas: JSON.stringify(r.failures.map((f) => ({ scenario: f.scenario, step: f.step, error: f.error, dir: f.dir }))),
    metricas: r.metrics ? JSON.stringify(r.metrics) : null,
    relatorio_id: r.id,
    erro: r.error ?? null,
  });
  return true;
}
