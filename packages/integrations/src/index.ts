import type { RunnerPlugin } from "@qastage/core-contract";
import { JiraClient } from "./jira/client";
import { readJiraConfig } from "./jira/config";
import { reportFailuresToJira } from "./jira/report";

export { fingerprint, normalizeError } from "./jira/fingerprint";
export type { JiraLink } from "./jira/report";

/**
 * Integrações: plugin sem executor. Ouve o fim de toda execução e, se o Jira
 * estiver configurado, abre/atualiza um card por falha. Sem configuração, não
 * faz nada — a integração é sempre opcional.
 */
export const integrationsPlugin: RunnerPlugin = {
  manifest: {
    name: "integrations",
    version: "0.0.0",
    description: "Jira: card automático na falha, com dedupe e anexos.",
  },
  async onRunFinished(event) {
    const r = readJiraConfig();
    if (!r.ok) return; // não configurado: silencioso de propósito
    await reportFailuresToJira(event, r.config);
  },
  routes: [
    {
      // Estado da integração, sem expor segredos. ?check=true testa as credenciais.
      method: "GET",
      path: "/status",
      handle: async ({ query }) => {
        const r = readJiraConfig();
        if (!r.ok) return { jira: { configured: false, missing: r.missing } };
        const { baseUrl, flavor, project, issueType, envs, attachTrace } = r.config;
        const jira: Record<string, unknown> = { configured: true, baseUrl, flavor, project, issueType, envs: envs ?? "todos", attachTrace };
        if (query.check === "true") {
          jira.check = await new JiraClient(r.config).whoAmI().then(
            (quem) => ({ ok: true, user: quem }),
            (e: Error) => ({ ok: false, error: e.message }),
          );
        }
        return { jira };
      },
    },
  ],
};
