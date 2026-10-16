import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { Artifact, FailureReport, RunResult, RunStatus, StepResult } from "@qastage/core-contract";
import { renderFailureMarkdown, renderHtml } from "./render";
import type { FailurePackage, RunReport, ScenarioReport } from "./types";

export interface WriteReportInput {
  artifactsRoot: string;
  artifactsDir: string;
  plugin: string;
  project?: { id: string; name: string };
  env: { name: string; baseUrl: string };
  result: RunResult;
  logs: string[];
}

export interface WrittenReport {
  report: RunReport;
  jsonPath: string;
  htmlPath: string;
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Caminhos sempre relativos à pasta da execução e com "/" (servem de URL). */
function rel(dir: string, path: string): string {
  return (isAbsolute(path) ? relative(dir, path) : path).split(sep).join("/");
}

const relArtifacts = (dir: string, list: Artifact[] = []) => list.map((a) => ({ ...a, path: rel(dir, a.path) }));

/** Grava report.json, report.html e um pacote por falha. Funciona para qualquer plugin. */
export function writeReport(input: WriteReportInput): WrittenReport {
  const { artifactsDir: dir, result } = input;

  const steps: StepResult[] = (result.steps ?? []).map((s) => ({ ...s, artifacts: relArtifacts(dir, s.artifacts) }));
  const counts: Record<RunStatus, number> = { passed: 0, failed: 0, skipped: 0, error: 0 };
  for (const s of steps) counts[s.status]++;

  const failures: FailurePackage[] = (result.failures ?? []).map((f, i) => writeFailure(dir, i, f, input));

  const report: RunReport = {
    id: rel(input.artifactsRoot, dir),
    plugin: input.plugin,
    ...(input.project ? { project: input.project } : {}),
    env: { name: input.env.name, baseUrl: input.env.baseUrl },
    status: result.status,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: Date.parse(result.finishedAt) - Date.parse(result.startedAt),
    counts,
    scenarios: groupScenarios(steps),
    failures,
    artifacts: relArtifacts(dir, result.artifacts),
    ...(result.metrics && Object.keys(result.metrics).length ? { metrics: result.metrics } : {}),
    logs: input.logs,
    ...(result.error ? { error: result.error } : {}),
  };

  const jsonPath = join(dir, "report.json");
  const htmlPath = join(dir, "report.html");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  writeFileSync(htmlPath, renderHtml(report), "utf8");
  return { report, jsonPath, htmlPath };
}

function writeFailure(dir: string, i: number, f: FailureReport, input: WriteReportInput): FailurePackage {
  const pasta = `falhas/${String(i + 1).padStart(2, "0")}-${slug(f.scenario)}`;
  const abs = join(dir, pasta);
  mkdirSync(abs, { recursive: true });
  const pkg: FailurePackage = { ...f, dir: pasta, artifacts: relArtifacts(dir, f.artifacts) };

  // Dentro do pacote, os caminhos apontam para os arquivos da execução (../../).
  const local = { ...pkg, artifacts: pkg.artifacts.map((a) => ({ ...a, path: `../../${a.path}` })) };
  const meta = { plugin: input.plugin, env: input.env, startedAt: input.result.startedAt };
  writeFileSync(join(abs, "falha.json"), JSON.stringify({ ...meta, ...local }, null, 2) + "\n", "utf8");
  writeFileSync(join(abs, "falha.md"), renderFailureMarkdown(local, meta), "utf8");
  return pkg;
}

/** Agrupa os passos por cenário, na ordem em que aparecem. */
function groupScenarios(steps: StepResult[]): ScenarioReport[] {
  const out: ScenarioReport[] = [];
  for (const s of steps) {
    const nome = s.scenario ?? "Execução";
    let sc = out.find((x) => x.name === nome);
    if (!sc) out.push((sc = { name: nome, status: "passed", steps: [] }));
    sc.steps.push(s);
    if (s.status === "failed" || s.status === "error") sc.status = s.status;
  }
  return out;
}
