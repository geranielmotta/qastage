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
  /** Ambiente selecionado no shell (resolvido da config do projeto, quando existe). */
  env: { name: string; baseUrl: string; apiUrl?: string; authUrl?: string; writable?: boolean; allowLoad?: boolean };
  /** Padrões do plugin vindos da config do projeto (ex.: pasta de mapas, fonte do Swagger). */
  defaults?: Record<string, string | number | boolean>;
  /** Projeto aberto no shell: o painel lista e salva os .feature dele e executa nele. */
  project?: { id: string; name: string };
  /** .feature a abrir de cara (relativo ao projeto), vindo da visão geral do projeto. */
  file?: string;
}

/** Caminho relativo a partir da pasta do projeto (ou da raiz do QAStage, sem projeto). */
export function projectPath(project: ProjectRef | undefined, path: string): string {
  if (/^https?:\/\//.test(path) || path.startsWith("/")) return path;
  const base = project?.dir ?? process.cwd();
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\.\//, "")}`;
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
  /** URL do front (telas). */
  baseUrl: string;
  /** URL da API, quando difere do front. Plugins de API usam `apiUrl ?? baseUrl`. */
  apiUrl?: string;
  authUrl?: string;
  /** Se o ambiente aceita operações de escrita (criar pedido, cadastro...). */
  writable: boolean;
  /** Se o ambiente está autorizado para teste de carga. */
  allowLoad?: boolean;
}

/**
 * qastage.config.json — a configuração de um projeto, versionada junto com os
 * .feature. O runner lê e resolve; plugins e shell recebem o resultado.
 */
export interface ProjectConfig {
  projeto: string;
  /** Ambiente usado quando nenhum é informado. */
  padrao?: string;
  ambientes: Record<string, EnvConfig>;
  /**
   * Parâmetros padrão por plugin (os mesmos de --<param> na CLI), ex.:
   * { "ui-testing": { "maps": "qastage/maps" }, "api-testing": { "spec": "..." } }.
   * O que vier no pedido de execução sobrescreve.
   */
  plugins?: Record<string, Record<string, string | number | boolean>>;
}

export interface EnvConfig {
  /** URL do front. */
  front: string;
  /** URL da API (padrão: a do front). */
  api?: string;
  auth?: string;
  /** Aceita escrita? Padrão false: criar registro em ambiente compartilhado precisa ser explícito. */
  escrita?: boolean;
  /** Autorizado para teste de carga? Padrão false. */
  carga?: boolean;
}

/** Projeto em que a execução acontece (um QA alterna entre vários no mesmo dia). */
export interface ProjectRef {
  /** Identificador estável (nome da pasta), ex.: "portal-clientes". */
  id: string;
  name: string;
  /** Pasta do projeto: caminhos relativos (Swagger, mapas, .feature) valem a partir dela. */
  dir: string;
}

/** Contexto passado ao executor a cada execução. */
export interface RunContext {
  env: ResolvedEnv;
  /** Projeto da execução; sem projeto, caminhos relativos valem a partir da raiz do QAStage. */
  project?: ProjectRef;
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
  kind: "screenshot" | "log" | "har" | "video" | "trace" | "report" | "other";
  path: string;
  label?: string;
}

export type RunStatus = "passed" | "failed" | "skipped" | "error";

/** Resultado de um passo/checagem individual. */
export interface StepResult {
  name: string;
  status: RunStatus;
  durationMs: number;
  /** Cenário ao qual o passo pertence (agrupa o relatório). */
  scenario?: string;
  /** Prints e outros arquivos do passo (documentação viva, também no sucesso). */
  artifacts?: Artifact[];
  error?: string;
  /**
   * Dados estruturados da falha, para o painel do plugin agir sobre ela
   * (ex.: o ui-testing manda o rótulo e a tela que não resolveram).
   */
  details?: Record<string, unknown>;
}

/**
 * Pacote de falha para o dev: tudo que ele precisa para reproduzir sem
 * perguntar ao QA. O executor monta; o módulo de reports grava e renderiza.
 */
export interface FailureReport {
  scenario: string;
  /** Passo que falhou, com a palavra-chave (ex.: 'E eu clico em "Entrar"'). */
  step: string;
  error: string;
  /** URL da tela no momento da falha. */
  url?: string;
  /** Dados usados no cenário até a falha (ex.: { "E-mail": "qa@empresa.com" }). */
  data: Record<string, string>;
  /** Passos até a falha, na ordem — o roteiro de reprodução. */
  stepsToReproduce: string[];
  /** Console e rede do alvo (erros JS, requisições 4xx/5xx...). */
  console?: string[];
  /** Arquivos da falha: print, trace, html da tela... */
  artifacts: Artifact[];
}

/** Resultado de uma execução completa, devolvido pelo executor ao runner. */
export interface RunResult {
  status: RunStatus;
  steps?: StepResult[];
  artifacts: Artifact[];
  /** Um pacote por cenário que falhou. */
  failures?: FailureReport[];
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
  /** Projeto informado em ?project=<id> (resolvido pelo runner). */
  project?: ProjectRef;
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

/** Falha com a pasta do pacote gravado pelo módulo de reports. Caminhos absolutos. */
export interface FailureWithPackage extends FailureReport {
  /** Pasta absoluta do pacote (falha.json, falha.md). */
  packageDir?: string;
}

/** Evento entregue aos plugins ao fim de toda execução (já com o relatório gravado). */
export interface RunFinishedEvent {
  plugin: string;
  project?: ProjectRef;
  env: { name: string; baseUrl: string };
  artifactsDir: string;
  result: RunResult;
  failures: FailureWithPackage[];
  /** report.html absoluto, quando gravado. */
  reportPath?: string;
  logger: Logger;
}

/** A metade "runner" de um plugin: o manifesto + a fábrica do executor. */
export interface RunnerPlugin {
  manifest: PluginManifest;
  /** Ausente em plugins que não executam testes (ex.: reports, integrations). */
  createExecutor?(): Executor;
  /** Rotas HTTP extras do plugin (opcional). */
  routes?: PluginApiRoute[];
  /**
   * Chamado ao fim de toda execução, de qualquer plugin (ex.: integrations
   * abre card no Jira). Roda em segundo plano: nunca atrasa nem derruba a
   * execução — erros só viram aviso no log.
   */
  onRunFinished?(event: RunFinishedEvent): Promise<void>;
}
