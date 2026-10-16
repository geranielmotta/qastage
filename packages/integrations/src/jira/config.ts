/**
 * Configuração do Jira, só por variáveis de ambiente (segredos nunca no repo).
 *
 *   QASTAGE_JIRA_URL           https://empresa.atlassian.net  (ou o Jira Server/DC)
 *   QASTAGE_JIRA_PROJECT       chave do projeto, ex.: QA
 *   QASTAGE_JIRA_EMAIL         + QASTAGE_JIRA_TOKEN  → Cloud (e-mail + API token)
 *   QASTAGE_JIRA_PAT           → Server/Data Center (Personal Access Token)
 *   QASTAGE_JIRA_FLAVOR        cloud | server  (padrão: cloud se a URL for *.atlassian.net)
 *   QASTAGE_JIRA_ISSUE_TYPE    padrão "Bug"
 *   QASTAGE_JIRA_ENVS          ambientes que abrem card, ex.: "qa,homolog" (padrão: todos)
 *   QASTAGE_JIRA_ATTACH_TRACE  true para anexar o trace.zip (pode conter dados digitados)
 *   QASTAGE_PUBLIC_URL         URL pública do runner, para o card linkar o relatório
 */
export interface JiraConfig {
  baseUrl: string;
  flavor: "cloud" | "server";
  auth: { type: "basic"; email: string; token: string } | { type: "bearer"; token: string };
  project: string;
  issueType: string;
  envs?: string[];
  attachTrace: boolean;
  publicUrl?: string;
  timeoutMs: number;
}

export type JiraConfigResult = { ok: true; config: JiraConfig } | { ok: false; missing: string[] };

export function readJiraConfig(env: NodeJS.ProcessEnv = process.env): JiraConfigResult {
  const v = (k: string) => env[k]?.trim() || undefined;
  const baseUrl = v("QASTAGE_JIRA_URL")?.replace(/\/+$/, "");
  const project = v("QASTAGE_JIRA_PROJECT");
  const pat = v("QASTAGE_JIRA_PAT");
  const email = v("QASTAGE_JIRA_EMAIL");
  const token = v("QASTAGE_JIRA_TOKEN");

  const missing: string[] = [];
  if (!baseUrl) missing.push("QASTAGE_JIRA_URL");
  if (!project) missing.push("QASTAGE_JIRA_PROJECT");
  if (!pat && !(email && token)) missing.push("QASTAGE_JIRA_EMAIL + QASTAGE_JIRA_TOKEN (Cloud) ou QASTAGE_JIRA_PAT (Server/DC)");
  if (missing.length) return { ok: false, missing };

  const flavorEnv = v("QASTAGE_JIRA_FLAVOR");
  const flavor = flavorEnv === "server" || flavorEnv === "cloud" ? flavorEnv : /\.atlassian\.net$/i.test(new URL(baseUrl!).hostname) ? "cloud" : "server";
  const envs = v("QASTAGE_JIRA_ENVS")?.split(",").map((s) => s.trim()).filter(Boolean);

  return {
    ok: true,
    config: {
      baseUrl: baseUrl!,
      flavor,
      auth: pat ? { type: "bearer", token: pat } : { type: "basic", email: email!, token: token! },
      project: project!,
      issueType: v("QASTAGE_JIRA_ISSUE_TYPE") ?? "Bug",
      ...(envs?.length ? { envs } : {}),
      attachTrace: v("QASTAGE_JIRA_ATTACH_TRACE") === "true",
      ...(v("QASTAGE_PUBLIC_URL") ? { publicUrl: v("QASTAGE_PUBLIC_URL")!.replace(/\/+$/, "") } : {}),
      timeoutMs: Number(v("QASTAGE_JIRA_TIMEOUT_MS") ?? 10000),
    },
  };
}
