import { pluginApi as pluginApiDe, withProject } from "@qastage/web-kit";

export { fetchFileJson, fileUrl, runAndWait, type RunRecord } from "@qastage/web-kit";

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

const pluginApi = (apiBase: string, path: string) => pluginApiDe(apiBase, "ui-testing", path);

export async function fetchSteps(apiBase: string): Promise<string[]> {
  const r = await fetch(pluginApi(apiBase, "/steps"), { credentials: "include" });
  if (!r.ok) throw new Error("Falha ao ler o vocabulário de passos");
  return (await r.json()) as string[];
}

export async function saveException(
  apiBase: string,
  project: { id: string } | undefined,
  body: { maps: string; tela: string; rotulo: string; locator: Record<string, string> },
): Promise<void> {
  const r = await fetch(withProject(pluginApi(apiBase, "/exceptions"), project), {
    credentials: "include",
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? `Runner respondeu ${r.status}`);
}

/** Detalhes que o executor anexa quando um rótulo não resolve. */
export interface NaoEncontrado {
  kind: "elemento-nao-encontrado";
  rotulo: string;
  tela: string;
  tentativas: string[];
}
