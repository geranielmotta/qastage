import type { PanelProps } from "@qastage/core-contract";

export type Env = PanelProps["env"];

/** Ambientes iniciais. A URL nunca fica no .feature: vem daqui. */
export const DEFAULT_ENVS: Env[] = [
  { name: "local", baseUrl: "http://localhost:4173" },
  { name: "dev", baseUrl: "https://dev.exemplo.com" },
  { name: "qa", baseUrl: "https://qa.exemplo.com" },
  { name: "homolog", baseUrl: "https://homolog.exemplo.com" },
];

const CHAVE = "qastage.envs";

export function loadEnvs(): Env[] {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo) return JSON.parse(salvo) as Env[];
  } catch {
    /* sem storage: usa o padrão */
  }
  return DEFAULT_ENVS;
}

export function saveEnvs(envs: Env[]): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(envs));
  } catch {
    /* sem storage: só não persiste */
  }
}
