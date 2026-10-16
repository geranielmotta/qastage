import type { PanelProps, RunResult } from "@qastage/core-contract";

/** Estado de uma execução como o runner devolve em GET /api/runs/:id. */
export interface RunRecord {
  id: string;
  state: "running" | "done";
  logs: Array<{ level: "info" | "warn" | "error"; msg: string }>;
  result?: RunResult;
  /** Caminho do report.html no runner (ex.: /artifacts/ui-testing/123/report.html). */
  reportUrl?: string;
}

export const fileUrl = (apiBase: string, path: string) => `${apiBase}/api/files?path=${encodeURIComponent(path)}`;

export const pluginApi = (apiBase: string, plugin: string, path: string) => `${apiBase}/api/plugins/${plugin}${path}`;

/** GET JSON com a mensagem de erro do runner quando falha. A sessão vai no cookie (credentials). */
export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `Runner respondeu ${r.status}`);
  return body;
}

export async function fetchFileJson<T>(apiBase: string, path: string): Promise<T> {
  return getJson<T>(fileUrl(apiBase, path));
}

/** Dispara a execução no runner e acompanha por polling até terminar. */
export async function runAndWait(apiBase: string, body: unknown, onUpdate: (r: RunRecord) => void): Promise<RunRecord> {
  const r = await fetch(`${apiBase}/api/runs`, {
    credentials: "include",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const resp = (await r.json()) as { id?: string; error?: string };
  if (!r.ok || !resp.id) throw new Error(resp.error ?? `Runner respondeu ${r.status}`);

  for (;;) {
    await new Promise((ok) => setTimeout(ok, 600));
    const rec = await getJson<RunRecord>(`${apiBase}/api/runs/${resp.id}`);
    onUpdate(rec);
    if (rec.state === "done") return rec;
  }
}

export { withProject, listFeatureFiles, readFeatureFile, saveFeatureFile, type FeatureFileInfo } from "./project";
export { FeatureFiles } from "./FeatureFiles";

/**
 * Onde executar: dentro de um projeto o runner resolve o ambiente pelo nome
 * (qastage.config.json do projeto); sem projeto, vai o ambiente completo.
 */
export function runTarget(p: Pick<PanelProps, "env" | "project">): { project?: string; env: Partial<PanelProps["env"]> } {
  return p.project ? { project: p.project.id, env: { name: p.env.name } } : { env: p.env };
}
