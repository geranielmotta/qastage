import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Artifact, Executor, FailureReport, RunContext, RunResult, StepResult } from "@qastage/core-contract";
import { Rng } from "@qastage/data";
import { mask, parseFeature } from "@qastage/feature";
import { loadSpec } from "./spec/load";
import { apiSteps } from "./steps";
import { SkipStep, type ApiWorld, type Exchange } from "./world";

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export class ApiExecutor implements Executor {
  async run(ctx: RunContext): Promise<RunResult> {
    const startedAt = new Date().toISOString();
    const fim = (r: Omit<RunResult, "startedAt" | "finishedAt">): RunResult => ({ ...r, startedAt, finishedAt: new Date().toISOString() });
    try {
      return fim(await this.runFeature(ctx));
    } catch (e) {
      return fim({ status: "error", error: (e as Error).message, artifacts: [] });
    }
  }

  private async runFeature(ctx: RunContext): Promise<Omit<RunResult, "startedAt" | "finishedAt">> {
    if (!ctx.featurePath) throw new Error("Informe o .feature: --feature caminho/arquivo.feature");
    const p = ctx.params ?? {};
    const timeoutMs = Number(p.timeout ?? 15000);
    // --spec é a fonte padrão do projeto; o passo "a API é descrita em" sobrescreve.
    const baseDir = ctx.project?.dir ?? process.cwd();
    const fonte = p.spec ? String(p.spec) : undefined;
    const spec = fonte ? await loadSpec(/^https?:\/\//.test(fonte) ? fonte : resolve(baseDir, fonte)) : undefined;
    // --seed reproduz exatamente os mesmos dados gerados.
    const seed = String(p.seed ?? Date.now());

    const steps: StepResult[] = [];
    const failures: FailureReport[] = [];

    for (const [i, cenario] of parseFeature(resolve(ctx.featurePath)).entries()) {
      ctx.logger.info(`Cenário: ${cenario.name}`);
      const pasta = `${String(i + 1).padStart(2, "0")}-${slug(cenario.name)}`;
      mkdirSync(join(ctx.artifactsDir, pasta), { recursive: true });

      const w: ApiWorld = {
        ...(spec ? { spec } : {}),
        baseDir,
        // Ambiente pode ter front e API em hosts diferentes.
        baseUrl: ctx.env.apiUrl ?? ctx.env.baseUrl,
        envName: ctx.env.name,
        writable: ctx.env.writable,
        headers: {},
        vars: {},
        exchanges: [],
        rng: new Rng(`${seed}:${cenario.name}`),
        data: {},
        secrets: new Set(),
        logger: ctx.logger,
        timeoutMs,
      };

      let falhou = false;
      const roteiro: string[] = [];
      for (const ps of cenario.steps) {
        const base = { name: `${cenario.name} › ${ps.keyword}${ps.text}`, scenario: cenario.name };
        if (falhou) {
          steps.push({ ...base, status: "skipped", durationMs: 0 });
          continue;
        }
        roteiro.push(`${ps.keyword}${ps.text}`);
        const antes = w.exchanges.length;
        const t0 = Date.now();
        let r: StepResult;
        try {
          const m = apiSteps.match(ps.text);
          await m.run(w, m.args, ps.table);
          r = { ...base, status: "passed", durationMs: Date.now() - t0 };
        } catch (e) {
          const error = mask((e as Error).message, w.secrets);
          if (e instanceof SkipStep) {
            ctx.logger.warn(`  ${base.name}: ${error}`);
            r = { ...base, status: "skipped", durationMs: Date.now() - t0, error };
          } else {
            falhou = true;
            ctx.logger.error(`  ${base.name}\n${error}`);
            r = { ...base, status: "failed", durationMs: Date.now() - t0, error };
          }
        }

        const doPasso = w.exchanges.slice(antes).map((ex, n) => saveExchange(ctx.artifactsDir, pasta, antes + n, ex, w.secrets));
        if (doPasso.length) r.artifacts = doPasso;
        steps.push(r);

        if (r.status === "failed") {
          const ult = w.last;
          failures.push({
            scenario: cenario.name,
            step: mask(`${ps.keyword}${ps.text}`, w.secrets),
            error: r.error!,
            ...(ult ? { url: `${ult.method} ${ult.url}` } : {}),
            data: { ...w.data },
            stepsToReproduce: roteiro.map((s) => mask(s, w.secrets)),
            console: w.exchanges.map((ex) =>
              mask(`${ex.method} ${ex.url} → ${ex.status} (${ex.durationMs} ms)${ex.label ? ` — ${ex.label}` : ""}`, w.secrets),
            ),
            artifacts: doPasso,
          });
        }
      }
    }

    const status = failures.length ? "failed" : "passed";
    return { status, steps, artifacts: [], failures, ...(failures[0] ? { error: failures[0].error } : {}) };
  }
}

/** Grava a troca HTTP em JSON, com Authorization e segredos mascarados. */
function saveExchange(dir: string, pasta: string, n: number, ex: Exchange, secrets: Set<string>): Artifact {
  const nome = `${String(n + 1).padStart(2, "0")}-${ex.method.toLowerCase()}-${slug(ex.endpoint.path).slice(0, 40) || "raiz"}-${ex.status}.json`;
  const path = join(dir, pasta, nome);
  const headers = Object.fromEntries(Object.entries(ex.requestHeaders).map(([k, v]) => [k, /authorization|api-key|cookie/i.test(k) ? "••••••" : v]));
  const conteudo = {
    endpoint: ex.endpoint.id,
    ...(ex.label ? { motivo: ex.label } : {}),
    request: { method: ex.method, url: ex.url, headers, body: ex.requestBody },
    response: { status: ex.status, durationMs: ex.durationMs, headers: ex.responseHeaders, body: ex.responseBody },
  };
  writeFileSync(path, mask(JSON.stringify(conteudo, null, 2), secrets) + "\n", "utf8");
  return { kind: "log", path, label: `${ex.method} ${ex.endpoint.path} → ${ex.status}${ex.label ? ` (${ex.label})` : ""}` };
}
