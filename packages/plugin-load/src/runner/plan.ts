import type { ApiSpec } from "@qastage/plugin-api";

/** Uma linha do mix: qual endpoint e com que peso ele entra no sorteio de cada iteração. */
export interface MixEntry {
  /** Como o QA escreveu ("POST /clientes", "GET /clientes/1"). */
  ref: string;
  weight: number;
}

/** Limite de aceite, traduzido para threshold do k6. */
export interface Threshold {
  /** Texto do passo, para o relatório. */
  label: string;
  /** Métrica do k6, com tag opcional: "http_req_duration{endpoint:POST /clientes}". */
  metric: string;
  /** Expressão do k6: "p(95)<300", "rate<0.01", "rate>50". */
  expr: string;
  /** Valor da métrica que o relatório mostra, e a unidade. */
  stat: "p(95)" | "p(99)" | "rate";
  unit: "ms" | "%" | "req/s";
}

/**
 * O que o .feature de carga descreve. Os passos não fazem requisições: eles
 * montam este plano, que vira um script k6.
 */
export interface LoadPlan {
  spec?: ApiSpec;
  /** Pasta base de caminhos relativos (a do projeto). */
  baseDir: string;
  login?: { ref: string; body: Record<string, string> };
  token?: string;
  /** Carga constante ou em rampa. */
  load?: { kind: "constant"; vus: number; duration: string } | { kind: "ramp"; vus: number; rampUp: string; hold: string };
  mix: MixEntry[];
  /** Pausa entre requisições de um mesmo usuário (padrão 1 s): carga realista, não martelada. */
  thinkTime: number;
  thresholds: Threshold[];
}
