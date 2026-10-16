import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import type { Logger } from "@qastage/core-contract";
import { listReports, type RunReport } from "@qastage/reports";
import { senhaTemporaria } from "./auth/senha";
import { createRegistry } from "./bootstrap";
import { conferirBanco, fecharDb } from "./db/conexao";
import { importarRelatorio } from "./db/execucoes";
import { alterarUsuario, buscarPorEmail, criarUsuario, listarUsuarios } from "./db/usuarios";
import { loadDotEnv } from "./env";
import { executarRegistrando } from "./execucao";
import { executeRun, type RunOutcome, type RunRequest } from "./execute";
import { listProjects } from "./projects";

const logger: Logger = {
  info: (m) => console.log(`[info] ${m}`),
  warn: (m) => console.warn(`[aviso] ${m}`),
  error: (m) => console.error(`[erro] ${m}`),
};

const OPCOES_DO_RUNNER = new Set(["project", "env", "url", "apiUrl", "authUrl", "feature"]);

const USO = `Uso:
  run <plugin> [--project <id>] [--env qa] [--url http://front] [--apiUrl http://api] [--feature arquivo.feature] [--<param> valor ...]
  list                                  plugins disponíveis
  projects                              projetos
  usuarios listar | admin <email> <nome> | senha <email>
  historico importar                    importa relatórios antigos (artifacts/) para o banco`;

interface ParsedArgs {
  comando: string | undefined;
  pluginName: string | undefined;
  opts: Record<string, string>;
}

/** Opções que o runner não conhece viram params do plugin (ex.: --mode scan --paths /login). */
function parseArgs(argv: string[]): ParsedArgs {
  const [comando, pluginName, ...rest] = argv;
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const chave = rest[i]?.replace(/^--/, "");
    const valor = rest[i + 1];
    if (chave && valor !== undefined) opts[chave] = valor;
  }
  return { comando, pluginName, opts };
}

/** Comandos de usuário: operação local de quem tem acesso à máquina do runner (não passa pela API). */
async function usuarios(sub: string | undefined, email: string | undefined, nome: string[]): Promise<void> {
  await conferirBanco();
  if (sub === "admin" && email && nome.length) {
    const senha = senhaTemporaria();
    const u = await criarUsuario({ nome: nome.join(" "), email, papel: "admin", senha });
    console.log(`Administrador ${u.nome} <${u.email}> criado.\nSenha temporária: ${senha}\n(troque no primeiro acesso: menu do usuário → Trocar senha)`);
    return;
  }
  if (sub === "senha" && email) {
    const u = await buscarPorEmail(email);
    if (!u) throw new Error(`Usuário ${email} não existe.`);
    const senha = senhaTemporaria();
    await alterarUsuario(u.id, { senha, ativo: true });
    console.log(`Nova senha temporária de ${u.email}: ${senha}`);
    return;
  }
  if (sub === "listar" || !sub) {
    const us = await listarUsuarios();
    if (!us.length) console.log("Nenhum usuário. Crie o admin: usuarios admin <email> <nome>");
    for (const u of us) {
      console.log(`  - ${u.email}  ${u.nome}  [${u.papel}${u.ativo ? "" : ", inativo"}]  projetos: ${u.papel === "admin" ? "todos" : u.projetos.join(", ") || "nenhum"}`);
    }
    return;
  }
  throw new Error(USO);
}

/** Traz para o banco os report.json gravados antes dele existir (idempotente). */
async function importarHistorico(): Promise<void> {
  await conferirBanco();
  const raiz = join(process.cwd(), "artifacts");
  let novos = 0;
  const todos = listReports(raiz, 100_000);
  for (const s of todos) {
    const r = JSON.parse(readFileSync(join(raiz, s.id, "report.json"), "utf8")) as RunReport;
    if (await importarRelatorio(r)) novos++;
  }
  console.log(`${novos} execução(ões) importada(s); ${todos.length - novos} já estavam no banco.`);
}

/**
 * Executa e registra no histórico do banco. A CLI é de quem opera a máquina:
 * sem banco disponível, executa mesmo assim e avisa que não ficou no histórico.
 */
async function executar(req: RunRequest): Promise<RunOutcome> {
  try {
    await conferirBanco();
  } catch (e) {
    logger.warn(`Execução não será registrada no histórico: ${(e as Error).message}`);
    const out = await executeRun(createRegistry(), req, logger);
    await out.hooks;
    return out;
  }
  const ex = await executarRegistrando(createRegistry(), req, logger, { origem: "cli", solicitanteNome: `CLI (${userInfo().username})` });
  const out = await ex.fim;
  await ex.integracoes; // o processo só sai depois do Jira e do registro dos cards
  logger.info(`Histórico: execução ${ex.id}`);
  return out;
}

async function main(): Promise<void> {
  loadDotEnv();
  // Alguns gerenciadores (pnpm) repassam um "--" literal; ignoramos esses tokens.
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const { comando, pluginName, opts } = parseArgs(argv);

  if (comando === "usuarios") return usuarios(argv[1], argv[2], argv.slice(3));
  if (comando === "historico" && argv[1] === "importar") return importarHistorico();

  if (comando === "projects") {
    console.log("Projetos:");
    for (const p of listProjects()) {
      console.log(`  - ${p.id}  ${p.name}${p.error ? "  [config inválida]" : `  (${Object.keys(p.config!.ambientes).join(", ")})`}`);
    }
    return;
  }

  if (!comando || comando === "list") {
    console.log("Plugins disponíveis:");
    for (const p of createRegistry().list()) console.log(`  - ${p.manifest.name}@${p.manifest.version}  ${p.manifest.description ?? ""}`);
    return;
  }

  if (comando !== "run" || !pluginName) throw new Error(USO);

  const { result, reportHtml } = await executar({
    plugin: pluginName,
    ...(opts.project ? { project: opts.project } : {}),
    // Com qastage.config.json, --env basta; --url/--apiUrl sobrescrevem as URLs do ambiente.
    env: { name: opts.env, baseUrl: opts.url, apiUrl: opts.apiUrl, authUrl: opts.authUrl },
    featurePath: opts.feature,
    params: Object.fromEntries(Object.entries(opts).filter(([k]) => !OPCOES_DO_RUNNER.has(k))),
  });

  logger.info(`Resultado: ${result.status}`);
  for (const step of result.steps ?? []) {
    logger.info(`  ${step.status === "passed" ? "✓" : step.status === "skipped" ? "-" : "✗"} ${step.name}`);
  }
  for (const a of result.artifacts) logger.info(`  artefato: ${a.kind} -> ${a.path}`);
  for (const f of result.failures ?? []) logger.error(`Falha em "${f.scenario}" › ${f.step}`);
  if (reportHtml) logger.info(`Relatório: ${reportHtml}`);
  if (result.status === "error" && result.error) logger.error(result.error);
  if (result.status !== "passed") process.exitCode = 1;
}

main()
  .catch((e: Error) => {
    // Erros de uso (config inválida, ambiente inexistente) saem como mensagem, sem stack.
    console.error(`[erro] ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => fecharDb());
