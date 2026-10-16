import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { RunReport, RunSummary } from "./types";

/** Lê os report.json de artifacts/<plugin>/<execução>/ e devolve o histórico, mais recente primeiro. */
export function listReports(artifactsRoot: string, limit = 100): RunSummary[] {
  if (!existsSync(artifactsRoot)) return [];
  const out: RunSummary[] = [];
  for (const plugin of readdirSync(artifactsRoot, { withFileTypes: true })) {
    if (!plugin.isDirectory()) continue;
    for (const run of readdirSync(join(artifactsRoot, plugin.name), { withFileTypes: true })) {
      const file = join(artifactsRoot, plugin.name, run.name, "report.json");
      if (!run.isDirectory() || !existsSync(file)) continue;
      try {
        const r = JSON.parse(readFileSync(file, "utf8")) as RunReport;
        out.push({
          id: r.id,
          plugin: r.plugin,
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
        });
      } catch {
        /* relatório corrompido: ignora */
      }
    }
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
}

function readJson<T>(file: string): T | undefined {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined;
  } catch {
    return undefined;
  }
}
