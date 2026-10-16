import type { Logger } from "@qastage/core-contract";
import type { Rng } from "@qastage/data";
import type { ApiSpec, Endpoint } from "./spec/model";

/** Uma requisição e sua resposta, como ficam gravadas nos artefatos. */
export interface Exchange {
  endpoint: Endpoint;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: unknown;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  durationMs: number;
  /** Rótulo do porquê desta chamada (ex.: "sem o campo cep"). */
  label?: string;
}

/** Estado de um cenário de API, compartilhado pelos passos. */
export interface ApiWorld {
  spec?: ApiSpec;
  baseUrl: string;
  envName: string;
  /** Ambiente aceita escrita? Senão, POST/PUT/PATCH/DELETE são bloqueados. */
  writable: boolean;
  /** Cabeçalhos fixos do cenário (Authorization, vindo do adapter de auth). */
  headers: Record<string, string>;
  /** Valores guardados entre passos ("eu guardo o campo id como id"). */
  vars: Record<string, unknown>;
  last?: Exchange;
  /** Todas as chamadas do cenário (viram artefatos). */
  exchanges: Exchange[];
  rng: Rng;
  /** Dados usados (vão para o pacote de falha). */
  data: Record<string, string>;
  secrets: Set<string>;
  logger: Logger;
  timeoutMs: number;
}

/** Passo que não se aplica (ex.: contrato numa collection do Postman, que não tem schema). */
export class SkipStep extends Error {}
