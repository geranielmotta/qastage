import type { Logger } from "@qastage/core-contract";
import { createRegistry } from "./bootstrap";
import { loadDotEnv } from "./env";
import { alterarUsuario, buscarPorEmail, criarUsuario, listarUsuarios, senhaTemporaria } from "./auth/users";
import { executeRun } from "./execute";
import { listProjects } from "./projects";

const logger: Logger = {
  info: (m) => console.log(`[info] ${m}`),
  warn: (m) => console.warn(`[aviso] ${m}`),
  error: (m) => console.error(`[erro] ${m}`),
};

const OPCOES_DO_RUNNER = new Set(["project", "env", "url", "apiUrl", "authUrl", "feature"]);

interface ParsedArgs {
  comando: string | undefined;
  pluginName: string | undefined;
  opts: Record<string, string>;
}

/**
 * Uso: run <plugin> [--project <id>] [--env qa] [--url http://front] [--apiUrl http://api] [--feature caminho.feature] [--<param> valor ...]
 * Opções que o runner não conhece viram params do plugin (ex.: --mode scan --paths /login).
 */
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

async function main(): Promise<void> {
  loadDotEnv();
  const registry = createRegistry();
  // Alguns gerenciadores (pnpm) repassam um "--" literal; ignoramos esses tokens.
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const { comando, pluginName, opts } = parseArgs(argv);

  if (comando === "usuarios") {
    // Operação local (quem tem acesso à máquina do runner): não passa pela API.
    const [, sub, email, ...nome] = argv;
    if (sub === "admin" && email && nome.length) {
      const senha = senhaTemporaria();
      const u = criarUsuario({ nome: nome.join(" "), email, papel: "admin", senha });
      console.log(`Administrador ${u.nome} <${u.email}> criado.\nSenha temporária: ${senha}\n(troque no primeiro acesso: menu do usuário → Trocar senha)`);
      return;
    }
    if (sub === "senha" && email) {
      const u = buscarPorEmail(email);
      if (!u) throw new Error(`Usuário ${email} não existe.`);
      const senha = senhaTemporaria();
      alterarUsuario(u.id, { senha, ativo: true });
      console.log(`Nova senha temporária de ${u.email}: ${senha}`);
      return;
    }
    if (sub === "listar" || !sub) {
      const us = listarUsuarios();
      if (!us.length) console.log("Nenhum usuário. Crie o admin: usuarios admin <email> <nome>");
      for (const u of us) console.log(`  - ${u.email}  ${u.nome}  [${u.papel}${u.ativo ? "" : ", inativo"}]  projetos: ${u.papel === "admin" ? "todos" : u.projetos.join(", ") || "nenhum"}`);
      return;
    }
    throw new Error("Uso: usuarios listar | usuarios admin <email> <nome> | usuarios senha <email>");
  }

  if (comando === "projects") {
    console.log("Projetos:");
    for (const p of listProjects()) {
      console.log(`  - ${p.id}  ${p.name}${p.error ? "  [config inválida]" : `  (${Object.keys(p.config!.ambientes).join(", ")})`}`);
    }
    return;
  }

  if (!comando || comando === "list") {
    console.log("Plugins disponíveis:");
    for (const p of registry.list()) {
      console.log(`  - ${p.manifest.name}@${p.manifest.version}  ${p.manifest.description ?? ""}`);
    }
    return;
  }

  if (comando !== "run" || !pluginName) {
    logger.error("Uso: run <plugin> [--env qa] [--url http://...] [--feature caminho.feature] [--<param> valor ...]");
    process.exitCode = 1;
    return;
  }

  const { result, reportHtml, hooks } = await executeRun(
    registry,
    {
      plugin: pluginName,
      ...(opts.project ? { project: opts.project } : {}),
      // Com qastage.config.json, --env basta; --url/--apiUrl sobrescrevem as URLs do ambiente.
      env: { name: opts.env, baseUrl: opts.url, apiUrl: opts.apiUrl, authUrl: opts.authUrl },
      featurePath: opts.feature,
      params: Object.fromEntries(Object.entries(opts).filter(([k]) => !OPCOES_DO_RUNNER.has(k))),
    },
    logger,
  );

  logger.info(`Resultado: ${result.status}`);
  for (const step of result.steps ?? []) {
    logger.info(`  ${step.status === "passed" ? "✓" : step.status === "skipped" ? "-" : "✗"} ${step.name}`);
  }
  for (const a of result.artifacts) {
    logger.info(`  artefato: ${a.kind} -> ${a.path}`);
  }

  for (const f of result.failures ?? []) {
    logger.error(`Falha em "${f.scenario}" › ${f.step}`);
  }
  if (reportHtml) logger.info(`Relatório: ${reportHtml}`);
  await hooks;
  if (result.status === "error" && result.error) logger.error(result.error);
  if (result.status !== "passed") process.exitCode = 1;
}

main().catch((e: Error) => {
  // Erros de uso (config inválida, ambiente inexistente) saem como mensagem, sem stack.
  console.error(`[erro] ${e.message}`);
  process.exitCode = 1;
});
