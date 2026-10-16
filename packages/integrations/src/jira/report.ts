import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { FailureWithPackage, RunFinishedEvent } from "@qastage/core-contract";
import type { JiraIssueRef } from "./client";
import { JiraClient } from "./client";
import type { JiraConfig } from "./config";
import { toAdf, toWiki, type Block } from "./doc";
import { fingerprint, fingerprintLabel } from "./fingerprint";

/** Gravado em falhas/NN-cenario/jira.json: o histórico mostra o link do card. */
export interface JiraLink extends JiraIssueRef {
  action: "created" | "commented";
  fingerprint: string;
  at: string;
}

/** Abre ou atualiza um card por falha. Erro numa falha não impede as outras. */
export async function reportFailuresToJira(event: RunFinishedEvent, cfg: JiraConfig, client = new JiraClient(cfg)): Promise<void> {
  const { logger } = event;
  if (!event.failures.length) return;
  if (cfg.envs && !cfg.envs.includes(event.env.name)) {
    logger.info(`Jira: ambiente "${event.env.name}" fora de QASTAGE_JIRA_ENVS; nenhum card.`);
    return;
  }

  // Mesma falha duas vezes na mesma execução → um card só (a busca do Jira pode demorar a indexar).
  const nestaExecucao = new Map<string, JiraIssueRef>();
  for (const f of event.failures) {
    const fp = fingerprint(event.plugin, f);
    try {
      const doc = describe(event, f, cfg, fp);
      const corpo = cfg.flavor === "cloud" ? toAdf(doc) : toWiki(doc);
      const existente =
        nestaExecucao.get(fp) ??
        (await client.findOne(`project = "${cfg.project}" AND labels = "${fingerprintLabel(fp)}" AND statusCategory != Done ORDER BY created DESC`));

      let link: JiraLink;
      if (existente) {
        await client.addComment(existente.key, corpo);
        link = { ...existente, action: "commented", fingerprint: fp, at: new Date().toISOString() };
        logger.info(`Jira: falha repetida em "${f.scenario}" → comentário em ${existente.key} (${existente.url})`);
      } else {
        const novo = await client.createIssue({
          project: { key: cfg.project },
          issuetype: { name: cfg.issueType },
          summary: summary(event, f),
          description: corpo,
          labels: ["qastage", `qastage-${event.plugin}`, fingerprintLabel(fp)],
        });
        link = { ...novo, action: "created", fingerprint: fp, at: new Date().toISOString() };
        logger.info(`Jira: card ${novo.key} criado para "${f.scenario}" (${novo.url})`);
      }
      nestaExecucao.set(fp, existente ?? link);

      await client.attach(link.key, attachments(f, cfg)).catch((e: Error) => logger.warn(`Jira: anexos não enviados para ${link.key}: ${e.message}`));
      if (f.packageDir) writeFileSync(join(f.packageDir, "jira.json"), JSON.stringify(link, null, 2) + "\n", "utf8");
    } catch (e) {
      logger.warn(`Jira: não consegui registrar a falha "${f.scenario}": ${(e as Error).message}`);
    }
  }
}

/** Jira limita o summary a 255 caracteres. */
function summary(event: RunFinishedEvent, f: FailureWithPackage): string {
  const s = `[QAStage][${event.env.name}] ${f.scenario} — ${f.step}`;
  return s.length > 250 ? s.slice(0, 249) + "…" : s;
}

function describe(event: RunFinishedEvent, f: FailureWithPackage, cfg: JiraConfig, fp: string): Block[] {
  const blocks: Block[] = [
    { t: "p", parts: [{ b: "Cenário:" }, " ", f.scenario] },
    { t: "p", parts: [{ b: "Passo que falhou:" }, " ", f.step] },
    { t: "p", parts: [{ b: "Ambiente:" }, " ", `${event.env.name} (${event.env.baseUrl})`, " · ", { b: "Plugin:" }, " ", event.plugin] },
  ];
  if (f.url) blocks.push({ t: "p", parts: [{ b: "Tela:" }, " ", { link: f.url }] });
  blocks.push({ t: "h", text: "Erro" }, { t: "code", text: f.error });
  blocks.push({ t: "h", text: "Como reproduzir" }, { t: "ol", items: f.stepsToReproduce });
  const dados = Object.entries(f.data);
  if (dados.length) blocks.push({ t: "h", text: "Dados usados" }, { t: "table", rows: dados });
  if (f.console?.length) blocks.push({ t: "h", text: "Console e rede do alvo" }, { t: "code", text: f.console.join("\n") });
  if (cfg.publicUrl && event.reportPath) {
    const rel = relative(join(process.cwd(), "artifacts"), event.reportPath).split(sep).join("/");
    blocks.push({ t: "p", parts: [{ b: "Relatório completo:" }, " ", { link: `${cfg.publicUrl}/artifacts/${rel}` }] });
  }
  blocks.push({ t: "p", parts: ["Aberto automaticamente pelo QAStage · fingerprint ", { code: fp }] });
  return blocks;
}

/** Print(s) da falha + falha.md; trace só se liberado (pode conter dados digitados). */
function attachments(f: FailureWithPackage, cfg: JiraConfig): string[] {
  const files = f.artifacts
    .filter((a) => a.kind === "screenshot" || (cfg.attachTrace && a.kind === "trace"))
    .map((a) => a.path)
    .filter((p) => existsSync(p));
  if (f.packageDir && existsSync(f.packageDir)) {
    for (const n of readdirSync(f.packageDir)) if (n === "falha.md") files.push(join(f.packageDir, n));
  }
  return files;
}
