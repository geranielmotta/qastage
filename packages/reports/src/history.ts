import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { RunReport, RunSummary } from "./types";

/**
 * Lê os report.json sob artifacts/ (artifacts/<projeto>/<plugin>/<execução>/,
 * e o layout antigo artifacts/<plugin>/<execução>/) e devolve o histórico,
 * mais recente primeiro. `project` filtra por projeto.
 */
export function listReports(artifactsRoot: string, limit = 100, project?: string): RunSummary[] {
  if (!existsSync(artifactsRoot)) return [];
  const out: RunSummary[] = [];
  const visitar = (dir: string, nivel: number) => {
    const file = join(dir, "report.json");
    if (existsSync(file)) {
      const s = resumo(artifactsRoot, file);
      if (s && (!project || s.project?.id === project)) out.push(s);
      return;
    }
    if (nivel >= 3) return;
    for (const d of readdirSync(dir, { withFileTypes: true })) if (d.isDirectory()) visitar(join(dir, d.name), nivel + 1);
  };
  visitar(artifactsRoot, 0);
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
}

function resumo(artifactsRoot: string, file: string): RunSummary | undefined {
  try {
    const r = JSON.parse(readFileSync(file, "utf8")) as RunReport;
    return {
      id: r.id,
      plugin: r.plugin,
      ...(r.project ? { project: r.project } : {}),
      env: r.env,
      status: r.status,
      startedAt: r.startedAt,
      durationMs: r.durationMs,
      counts: r.counts,
      failures: r.failures.map((f) => {
        const jira = readJson<{ key: string; url: string; action: "created" | "commented" }>(join(artifactsRoot, r.id, f.dir, "jira.json"));
        return {
          scenario: f.scenario,
          step: f.step,
          error: f.error,
          dir: f.dir,
          ...(jira ? { jira: { key: jira.key, url: jira.url, action: jira.action } } : {}),
        };
      }),
    };
  } catch {
    return undefined; // relatório corrompido: ignora
  }
}

function readJson<T>(file: string): T | undefined {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined;
  } catch {
    return undefined;
  }
}
