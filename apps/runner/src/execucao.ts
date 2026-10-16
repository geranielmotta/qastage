import { join } from "node:path";
import type { Logger } from "@qastage/core-contract";
import { registrarFim, registrarInicio, registrarIntegracoes } from "./db/execucoes";
import type { Usuario } from "./db/usuarios";
import { executeRun, type RunOutcome, type RunRequest } from "./execute";
import type { PluginRegistry } from "./registry";

export interface Execucao {
  id: string;
  /** Resolve quando a execução e o registro no banco terminam (as integrações seguem em segundo plano). */
  fim: Promise<RunOutcome>;
  /** Resolve quando as integrações (Jira...) terminam e o banco foi atualizado com os cards. */
  integracoes: Promise<void>;
}

/**
 * Executa registrando no banco: início (status running), fim (resumo do
 * report.json) e, depois das integrações, os cards do Jira. Ponto único para
 * a API e a CLI.
 */
export async function executarRegistrando(
  registry: PluginRegistry,
  req: RunRequest,
  logger: Logger,
  quem: { origem: "api" | "cli"; usuario?: Pick<Usuario, "id" | "nome">; solicitanteNome?: string },
): Promise<Execucao> {
  const id = await registrarInicio({
    plugin: req.plugin,
    ...(req.project ? { projetoId: req.project } : {}),
    ...(req.env.name ? { ambiente: req.env.name } : {}),
    origem: quem.origem,
    ...(quem.usuario ? { usuario: quem.usuario } : {}),
    ...(quem.solicitanteNome ? { solicitanteNome: quem.solicitanteNome } : {}),
  });

  let avisarIntegracoes: () => void = () => undefined;
  const integracoes = new Promise<void>((ok) => (avisarIntegracoes = ok));

  const fim = executeRun(registry, req, logger).then(
    async (out) => {
      await registrarFim(id, { status: out.result.status, ambiente: out.envName, ...(out.report ? { report: out.report } : {}), logs: out.logs });
      out.hooks
        .then(() => registrarIntegracoes(id, join(process.cwd(), "artifacts")))
        .catch((e: Error) => logger.warn(`Cards do Jira não registrados no histórico: ${e.message}`))
        .finally(avisarIntegracoes);
      return out;
    },
    async (e: Error) => {
      await registrarFim(id, { status: "error", erro: e.message, logs: [] }).catch(() => undefined);
      avisarIntegracoes();
      throw e;
    },
  );
  return { id, fim, integracoes };
}
