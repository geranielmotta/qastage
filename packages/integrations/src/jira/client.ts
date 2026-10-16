import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { JiraConfig } from "./config";

export interface JiraIssueRef {
  key: string;
  /** Link navegável do card (…/browse/KEY). */
  url: string;
}

const MIME: Record<string, string> = { ".png": "image/png", ".md": "text/markdown", ".zip": "application/zip", ".html": "text/html" };

/** Cliente REST mínimo do Jira, nas versões Cloud (v3) e Server/DC (v2). */
export class JiraClient {
  private readonly api: string;

  constructor(private readonly cfg: JiraConfig) {
    this.api = `${cfg.baseUrl}/rest/api/${cfg.flavor === "cloud" ? 3 : 2}`;
  }

  browseUrl(key: string): string {
    return `${this.cfg.baseUrl}/browse/${key}`;
  }

  /** Primeiro card que casa com a JQL, ou undefined. */
  async findOne(jql: string): Promise<JiraIssueRef | undefined> {
    // Cloud aposentou o /search em favor do /search/jql; Server/DC segue no /search.
    const rota = this.cfg.flavor === "cloud" ? "/search/jql" : "/search";
    const qs = new URLSearchParams({ jql, maxResults: "1", fields: "summary,status" });
    const r = (await this.request("GET", `${rota}?${qs}`)) as { issues?: Array<{ key: string }> };
    const key = r.issues?.[0]?.key;
    return key ? { key, url: this.browseUrl(key) } : undefined;
  }

  async createIssue(fields: Record<string, unknown>): Promise<JiraIssueRef> {
    const r = (await this.request("POST", "/issue", { fields })) as { key: string };
    return { key: r.key, url: this.browseUrl(r.key) };
  }

  async addComment(key: string, body: unknown): Promise<void> {
    await this.request("POST", `/issue/${encodeURIComponent(key)}/comment`, { body });
  }

  async attach(key: string, files: string[]): Promise<void> {
    if (!files.length) return;
    const form = new FormData();
    for (const f of files) {
      const ext = f.slice(f.lastIndexOf("."));
      form.append("file", new Blob([await readFile(f)], { type: MIME[ext] ?? "application/octet-stream" }), basename(f));
    }
    // Sem o X-Atlassian-Token o Jira recusa o upload (proteção XSRF).
    await this.request("POST", `/issue/${encodeURIComponent(key)}/attachments`, form, { "X-Atlassian-Token": "no-check" });
  }

  /** Conferência de credenciais (rota de status do plugin). */
  async whoAmI(): Promise<string> {
    const r = (await this.request("GET", "/myself")) as { displayName?: string; name?: string; emailAddress?: string };
    return r.displayName ?? r.name ?? r.emailAddress ?? "ok";
  }

  /** Timeout por chamada + 2 novas tentativas em erro de rede, 429 ou 5xx. */
  private async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<unknown> {
    const auth =
      this.cfg.auth.type === "basic"
        ? `Basic ${Buffer.from(`${this.cfg.auth.email}:${this.cfg.auth.token}`).toString("base64")}`
        : `Bearer ${this.cfg.auth.token}`;
    const isForm = body instanceof FormData;

    let ultimo: Error = new Error("sem tentativa");
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      if (tentativa > 0) await new Promise((ok) => setTimeout(ok, 500 * 2 ** tentativa));
      try {
        const res = await fetch(this.api + path, {
          method,
          headers: {
            authorization: auth,
            accept: "application/json",
            ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}),
            ...headers,
          },
          body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
          signal: AbortSignal.timeout(this.cfg.timeoutMs),
        });
        const texto = await res.text();
        if (res.ok) return texto ? JSON.parse(texto) : {};
        ultimo = new Error(`Jira ${method} ${path} → ${res.status}: ${texto.slice(0, 300)}`);
        if (res.status !== 429 && res.status < 500) break; // erro do pedido: repetir não adianta
      } catch (e) {
        ultimo = e as Error;
      }
    }
    throw ultimo;
  }
}
