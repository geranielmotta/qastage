import { getJson } from "./index";

export interface FeatureFileInfo {
  path: string;
  plugin: string;
  title: string;
  scenarios: number;
}

/** Acrescenta ?project=<id> às rotas de plugin quando há projeto aberto. */
export function withProject(url: string, project?: { id: string }): string {
  if (!project) return url;
  return url + (url.includes("?") ? "&" : "?") + "project=" + encodeURIComponent(project.id);
}

export async function listFeatureFiles(apiBase: string, projectId: string, plugin: string): Promise<FeatureFileInfo[]> {
  const todos = await getJson<FeatureFileInfo[]>(`${apiBase}/api/projects/${projectId}/features`);
  return todos.filter((f) => f.plugin === plugin);
}

export async function readFeatureFile(apiBase: string, projectId: string, path: string): Promise<string> {
  return (await getJson<{ text: string }>(`${apiBase}/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`)).text;
}

export async function saveFeatureFile(apiBase: string, projectId: string, path: string, text: string): Promise<void> {
  const r = await fetch(`${apiBase}/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Runner respondeu ${r.status}`);
}
