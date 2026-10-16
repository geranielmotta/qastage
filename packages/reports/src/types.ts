import type { Artifact, FailureReport, RunStatus, StepResult } from "@qastage/core-contract";

/**
 * report.json — o relatório de uma execução, de qualquer plugin. Todos os
 * caminhos de arquivo são relativos à pasta da execução: a pasta inteira pode
 * ser zipada, anexada ou servida sem quebrar links.
 */
export interface RunReport {
  /** Pasta da execução relativa à raiz de artefatos, ex.: "ui-testing/1792165680981". */
  id: string;
  plugin: string;
  project?: { id: string; name: string };
  /** Quem pediu a execução (usuário do shell); ausente na CLI. */
  requestedBy?: string;
  env: { name: string; baseUrl: string };
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  counts: Record<RunStatus, number>;
  scenarios: ScenarioReport[];
  failures: FailurePackage[];
  artifacts: Artifact[];
  /** Métricas do executor (ex.: p95, vazão, taxa de erro de um teste de carga). */
  metrics?: Record<string, number>;
  error?: string;
  /** Log do runner durante a execução. */
  logs: string[];
}

export interface ScenarioReport {
  name: string;
  status: RunStatus;
  steps: StepResult[];
}

/** Uma falha gravada como pacote em falhas/NN-cenario/ (falha.json + falha.md). */
export interface FailurePackage extends FailureReport {
  /** Pasta do pacote, relativa à execução. */
  dir: string;
}

/** Linha do histórico: o essencial de um report.json. */
export interface RunSummary {
  id: string;
  plugin: string;
  project?: { id: string; name: string };
  env: { name: string; baseUrl: string };
  status: RunStatus;
  startedAt: string;
  durationMs: number;
  counts: Record<RunStatus, number>;
  failures: Array<{
    scenario: string;
    step: string;
    error: string;
    dir: string;
    /** Card aberto/comentado pela integração (lido de falhas/NN/jira.json, gravado depois do relatório). */
    jira?: { key: string; url: string; action: "created" | "commented" };
  }>;
}
