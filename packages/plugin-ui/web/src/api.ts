import type { RunResult } from "@qastage/core-contract";

export interface RunRecord {
  id: string;
  state: "running" | "done";
  logs: Array<{ level: "info" | "warn" | "error"; msg: string }>;
  result?: RunResult;
}

export interface Resolucao {
  cenario: string;
  tela: string;
  rotulo: string;
  estrategia: "manual" | "testid" | "testid-mapa" | "semantico";
  como: string;
}

export interface ScannedElement {
  testid?: string;
  tag: string;
  role?: string;
  label?: string;
  suggestedTestid?: string;
}

export interface ScreenMap {
  screen: string;
  url: string;
  scannedAt: string;
  testIdAttribute: string;
  elements: ScannedElement[];
  missingTestid: ScannedElement[];
}

export const fileUrl = (apiBase: string, path: string) => `${apiBase}/api/files?path=${encodeURIComponent(path)}`;

export async function fetchFileJson<T>(apiBase: string, path: string): Promise<T> {
  const r = await fetch(fileUrl(apiBase, path));
  if (!r.ok) throw new Error(`Falha ao ler ${path}`);
  return (await r.json()) as T;
}

/** Dispara a execução no runner e acompanha por polling até terminar. */
export async function runAndWait(
  apiBase: string,
  body: unknown,
  onUpdate: (r: RunRecord) => void,
): Promise<RunRecord> {
  const r = await fetch(`${apiBase}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const resp = (await r.json()) as { id?: string; error?: string };
  if (!r.ok || !resp.id) throw new Error(resp.error ?? `Runner respondeu ${r.status}`);

  for (;;) {
    await new Promise((ok) => setTimeout(ok, 600));
    const rec = (await (await fetch(`${apiBase}/api/runs/${resp.id}`)).json()) as RunRecord;
    onUpdate(rec);
    if (rec.state === "done") return rec;
  }
}
