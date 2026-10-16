import type { PluginManifest, WebRemote } from "@qastage/core-contract";

export const API = import.meta.env.VITE_QASTAGE_API ?? "http://localhost:4000";

export interface Ambiente {
  name: string;
  baseUrl: string;
  apiUrl?: string;
  authUrl?: string;
  writable: boolean;
  allowLoad?: boolean;
}

export interface UltimaExecucao {
  id: string;
  plugin: string;
  status: "passed" | "failed" | "error" | "skipped";
  startedAt: string;
  env: string;
  counts: Record<string, number>;
}

/** Linha do dashboard (GET /api/projects). */
export interface ProjetoResumo {
  id: string;
  name: string;
  dir: string;
  error?: string;
  padrao?: string;
  ambientes?: Ambiente[];
  cenarios?: Record<string, number>;
  arquivos?: number;
  ultimas?: UltimaExecucao[];
}

/** Projeto aberto (GET /api/projects/:id). */
export interface Projeto {
  id: string;
  name: string;
  padrao: string;
  ambientes: Ambiente[];
  plugins: Record<string, Record<string, string | number | boolean>>;
}

export type ComPainel = PluginManifest & { webRemote: WebRemote };

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, init);
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `Runner respondeu ${r.status}`);
  return body;
}

/** Ambiente escolhido por projeto, lembrado neste navegador. */
export const envEscolhido = {
  get(projeto: string): string | null {
    try {
      return localStorage.getItem(`qastage.env.${projeto}`);
    } catch {
      return null;
    }
  },
  set(projeto: string, env: string): void {
    try {
      localStorage.setItem(`qastage.env.${projeto}`, env);
    } catch {
      /* sem storage */
    }
  },
};

export const ROTULO_PLUGIN: Record<string, string> = {
  "ui-testing": "Telas",
  "api-testing": "APIs",
  "load-testing": "Carga",
};

export const PASTA_PLUGIN: Record<string, string> = {
  "ui-testing": "features/ui",
  "api-testing": "features/api",
  "load-testing": "features/carga",
};
