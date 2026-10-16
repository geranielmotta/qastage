/**
 * Contrato de plugin do QAStage.
 *
 * Um plugin tem duas metades: a do front (um remote federado, descrito aqui só
 * pelo essencial) e a do runner (um executor). O ponto central é que o contrato
 * NÃO assume Cucumber: um executor pode ser Cucumber+Playwright, o k6, ou
 * qualquer outro motor. Cucumber é um executor entre outros.
 */

/** Identidade e metadados de um plugin, usados no catálogo e no registro. */
export interface PluginManifest {
  /** Nome único do plugin, ex.: "ui-testing", "api-testing", "load-testing". */
  name: string;
  /** Versão semver do plugin. */
  version: string;
  /** Descrição curta para o catálogo exibido ao QA. */
  description?: string;
  /** Metade do front: o remote federado que o shell carrega em runtime. */
  webRemote?: WebRemote;
}

/**
 * Como o shell acha o painel do plugin (Module Federation). O shell lê isto de
 * GET /api/plugins e registra o remote em runtime — plugin novo não exige
 * rebuild do shell.
 */
export interface WebRemote {
  /** Nome do remote no Module Federation, ex.: "qastage_ui". */
  name: string;
  /** URL do remoteEntry.js, ex.: "http://localhost:5174/remoteEntry.js". */
  entry: string;
  /** Módulo exposto que exporta o painel por padrão, ex.: "./Panel". */
  module: string;
  /** Título na navegação do shell. */
  title: string;
  /** Rota do painel dentro do shell, ex.: "/ui". */
  route: string;
}

/**
 * Props que o shell passa a todo painel de plugin. É o contrato do lado front:
 * o painel não sabe onde o runner está nem qual ambiente foi escolhido.
 */
export interface PanelProps {
  /** Base da API do runner, ex.: "http://localhost:4000". */
  apiBase: string;
  /** Ambiente selecionado no shell. */
  env: { name: string; baseUrl: string; authUrl?: string };
}

/** Logger simples injetado no executor; o runner decide para onde vai. */
export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** Ambiente resolvido onde o teste roda (dev/qa/homolog/local). */
export interface ResolvedEnv {
  name: string;
  baseUrl: string;
  authUrl?: string;
  /** Se o ambiente aceita operações de escrita (criar pedido, cadastro...). */
  writable: boolean;
}

/** Contexto passado ao executor a cada execução. */
export interface RunContext {
  env: ResolvedEnv;
  /** Caminho do arquivo .feature, quando o executor é guiado por Gherkin. */
  featurePath?: string;
  /** Diretório onde o executor grava artefatos (prints, logs, har...). */
  artifactsDir: string;
  logger: Logger;
  /** Parâmetros livres do plugin (ex.: VUs e duração do k6). */
  params?: Record<string, unknown>;
}

/** Artefato produzido numa execução. */
export interface Artifact {
  kind: "screenshot" | "log" | "har" | "video" | "report" | "other";
  path: string;
  label?: string;
}

export type RunStatus = "passed" | "failed" | "skipped" | "error";

/** Resultado de um passo/checagem individual. */
export interface StepResult {
  name: string;
  status: RunStatus;
  durationMs: number;
  error?: string;
  /**
   * Dados estruturados da falha, para o painel do plugin agir sobre ela
   * (ex.: o ui-testing manda o rótulo e a tela que não resolveram).
   */
  details?: Record<string, unknown>;
}

/** Resultado de uma execução completa, devolvido pelo executor ao runner. */
export interface RunResult {
  status: RunStatus;
  steps?: StepResult[];
  artifacts: Artifact[];
  /** Mensagem de erro quando status é "failed" ou "error". */
  error?: string;
  /** Métricas livres (ex.: p95, taxa de erro de um teste de carga). */
  metrics?: Record<string, number>;
  startedAt: string;
  finishedAt: string;
}

/**
 * O executor é o motor de um plugin. Recebe o contexto e devolve o resultado.
 * Cada plugin fornece o seu — Cucumber, k6, ou outro.
 */
export interface Executor {
  run(ctx: RunContext): Promise<RunResult>;
}

/** Requisição recebida por uma rota HTTP de plugin. */
export interface PluginApiRequest {
  query: Record<string, string>;
  body: unknown;
}

/**
 * Rota HTTP contribuída pelo plugin, montada pelo runner em
 * /api/plugins/<nome><path>. É por aqui que o painel do plugin conversa com a
 * metade runner além de disparar execuções (vocabulário, exceções...).
 */
export interface PluginApiRoute {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Começa com "/", ex.: "/steps". */
  path: string;
  /** Devolve o corpo JSON. Erro lançado vira 400 com { error }. */
  handle(req: PluginApiRequest): Promise<unknown>;
}

/** A metade "runner" de um plugin: o manifesto + a fábrica do executor. */
export interface RunnerPlugin {
  manifest: PluginManifest;
  createExecutor(): Executor;
  /** Rotas HTTP extras do plugin (opcional). */
  routes?: PluginApiRoute[];
}
