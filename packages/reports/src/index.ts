import type { RunnerPlugin } from "@qastage/core-contract";

export { writeReport, type WriteReportInput, type WrittenReport } from "./write";
export { listReports } from "./history";
export type { FailurePackage, RunReport, RunSummary, ScenarioReport } from "./types";

/**
 * O módulo de reports também é um plugin — sem executor: contribui o painel
 * de histórico no shell. O runner chama writeReport ao fim de toda execução,
 * de qualquer plugin, e guarda o resumo no banco (GET /api/runs).
 */
export const reportsPlugin: RunnerPlugin = {
  manifest: {
    name: "reports",
    version: "0.0.0",
    description: "Histórico de execuções, relatório navegável e pacote de falha para o dev.",
    webRemote: {
      name: "qastage_reports",
      entry: process.env.QASTAGE_REPORTS_REMOTE ?? "http://localhost:5175/remoteEntry.js",
      module: "./Panel",
      title: "Relatórios",
      route: "/reports",
    },
  },
};
