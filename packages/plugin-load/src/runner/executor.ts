import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Artifact, Executor, FailureReport, RunContext, RunResult, StepResult } from "@qastage/core-contract";
import { isSensitiveField } from "@qastage/data";
import { mask, parseFeature } from "@qastage/feature";
import { findEndpoint, loadSpec } from "@qastage/plugin-api";
import type { LoadPlan, Threshold } from "./plan";
import { renderScript, resolveMix } from "./script";
import { loadSteps } from "./steps";

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** k6 trabalha em ms; "rate" de erro vira %. */
interface MetricValues {
  [stat: string]: number;
}
interface K6Summary {
  metrics: Record<string, { values: MetricValues; thresholds?: Record<string, { ok: boolean }> }>;
  state?: { testRunDurationMs?: number };
}

/**
 * Carga só onde foi autorizada: "carga": true no ambiente (qastage.config.json),
 * ambiente listado em QASTAGE_LOAD_ENVS, ou URL local.
 */
function autorizado(ctx: RunContext): boolean {
  if (ctx.env.allowLoad) return true;
  const lista = (process.env.QASTAGE_LOAD_ENVS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const host = new URL(apiUrl(ctx)).hostname;
  return lista.includes(ctx.env.name) || ["localhost", "127.0.0.1", "::1"].includes(host);
}

const apiUrl = (ctx: RunContext) => ctx.env.apiUrl ?? ctx.env.baseUrl;

function interpolarEnv(v: string, segredos: Set<string>): string {
  return v.replace(/\$\{(\w+)\}/g, (_, n: string) => {
    const x = process.env[n];
    if (x === undefined) throw new Error(`Variável de ambiente ${n} não definida (use o .env da raiz).`);
    segredos.add(x);
    return x;
  });
}

export class LoadExecutor implements Executor {
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
    if (!autorizado(ctx)) {
      throw new Error(
        `Carga não autorizada no ambiente "${ctx.env.name}" (${apiUrl(ctx)}). ` +
          `Teste de carga só roda em ambiente liberado: marque "carga": true nesse ambiente do qastage.config.json ` +
          `(ou liste-o em QASTAGE_LOAD_ENVS no .env). URLs locais são liberadas.`,
      );
    }
    const p = ctx.params ?? {};
    const maxVus = Number(process.env.QASTAGE_LOAD_MAX_VUS ?? 100);
    const seed = String(p.seed ?? Date.now());
    const spec = p.spec ? await loadSpec(String(p.spec)) : undefined;

    const steps: StepResult[] = [];
    const artifacts: Artifact[] = [];
    const failures: FailureReport[] = [];
    const metrics: Record<string, number> = {};
    const cenarios = parseFeature(resolve(ctx.featurePath));

    for (const [i, cenario] of cenarios.entries()) {
      ctx.logger.info(`Cenário de carga: ${cenario.name}`);
      const pasta = join(ctx.artifactsDir, `${String(i + 1).padStart(2, "0")}-${slug(cenario.name)}`);
      mkdirSync(pasta, { recursive: true });
      const plan: LoadPlan = { ...(spec ? { spec } : {}), mix: [], thinkTime: 1, thresholds: [] };
      const segredos = new Set<string>();
      const nome = (s: { keyword: string; text: string }) => `${cenario.name} › ${s.keyword}${s.text}`;

      // 1) Os passos montam o plano (nada é enviado ainda).
      const passos: Array<{ step: (typeof cenario.steps)[number]; threshold?: Threshold }> = [];
      let erroPlano: { step: (typeof cenario.steps)[number]; error: string } | undefined;
      for (const s of cenario.steps) {
        const antes = plan.thresholds.length;
        try {
          const m = loadSteps.match(s.text);
          await m.run(plan, m.args, s.table);
          passos.push(plan.thresholds.length > antes ? { step: s, threshold: plan.thresholds.at(-1)! } : { step: s });
        } catch (e) {
          erroPlano = { step: s, error: (e as Error).message };
          break;
        }
      }
      if (!erroPlano && !plan.load) erroPlano = { step: cenario.steps.at(-1)!, error: 'Falta a carga: "20 usuários virtuais por \\"1m\\"" ou "a carga sobe até ...".' };
      if (!erroPlano && !plan.mix.length) erroPlano = { step: cenario.steps.at(-1)!, error: 'Falta o mix: "cada usuário executa:" com a tabela | endpoint | peso |.' };
      if (!erroPlano && plan.load!.vus > maxVus) {
        erroPlano = { step: cenario.steps.at(-1)!, error: `${plan.load!.vus} usuários passa do teto de ${maxVus} (QASTAGE_LOAD_MAX_VUS).` };
      }

      let entries: ReturnType<typeof resolveMix> = [];
      if (!erroPlano) {
        try {
          entries = resolveMix(plan, ctx.env.writable, ctx.env.name, seed);
        } catch (e) {
          erroPlano = { step: cenario.steps.find((s) => /executa:/.test(s.text)) ?? cenario.steps.at(-1)!, error: (e as Error).message };
        }
      }
      if (erroPlano) {
        for (const s of cenario.steps) {
          const falhou = s === erroPlano.step;
          steps.push({ name: nome(s), scenario: cenario.name, status: falhou ? "failed" : "skipped", durationMs: 0, ...(falhou ? { error: erroPlano.error } : {}) });
        }
        failures.push({ scenario: cenario.name, step: `${erroPlano.step.keyword}${erroPlano.step.text}`, error: erroPlano.error, data: {}, stepsToReproduce: cenario.steps.map((s) => `${s.keyword}${s.text}`), artifacts: [] });
        ctx.logger.error(`  ${erroPlano.error}`);
        continue;
      }

      // 2) Gera o script e roda o k6.
      const env: Record<string, string> = { QASTAGE_BASE_URL: apiUrl(ctx).replace(/\/+$/, ""), QASTAGE_SUMMARY: join(pasta, "summary.json") };
      let loginPath: string | undefined;
      if (plan.login) {
        const corpo = Object.fromEntries(Object.entries(plan.login.body).map(([k, v]) => {
          const val = interpolarEnv(v, segredos);
          if (isSensitiveField(k)) segredos.add(val);
          return [k, val];
        }));
        loginPath = findEndpoint(plan.spec!, plan.login.ref).endpoint.path;
        env.QASTAGE_LOGIN_BODY = JSON.stringify(corpo);
      } else if (plan.token) {
        env.QASTAGE_TOKEN = interpolarEnv(plan.token, segredos);
        segredos.add(env.QASTAGE_TOKEN);
      }
      const scriptPath = join(pasta, "script.js");
      writeFileSync(scriptPath, renderScript(plan, entries, loginPath), "utf8");
      const desc = plan.load!.kind === "constant" ? `${plan.load!.vus} VUs por ${plan.load!.duration}` : `rampa até ${plan.load!.vus} VUs em ${plan.load!.rampUp}, platô ${plan.load!.hold}`;
      ctx.logger.info(`  k6: ${desc}; mix ${entries.map((e) => `${e.ref}×${e.weight}`).join(", ")}`);

      const t0 = Date.now();
      const { code, output } = await runK6(scriptPath, env);
      const logPath = join(pasta, "k6.log");
      writeFileSync(logPath, mask(output, segredos), "utf8");
      const arquivos: Artifact[] = [
        { kind: "other", path: scriptPath, label: "script k6 gerado" },
        { kind: "log", path: logPath, label: "saída do k6" },
      ];
      const summaryPath = env.QASTAGE_SUMMARY!;
      if (!existsSync(summaryPath)) {
        const error = `k6 terminou com código ${code} sem resumo.\n${mask(output, segredos).trim().split("\n").slice(-8).join("\n")}`;
        for (const s of cenario.steps) steps.push({ name: nome(s), scenario: cenario.name, status: "failed", durationMs: 0, error });
        failures.push({ scenario: cenario.name, step: "execução do k6", error, data: {}, stepsToReproduce: cenario.steps.map((s) => `${s.keyword}${s.text}`), artifacts: arquivos });
        artifacts.push(...arquivos);
        continue;
      }
      arquivos.push({ kind: "report", path: summaryPath, label: "resumo do k6 (summary.json)" });
      artifacts.push(...arquivos);
      // Segunda barreira: mascara qualquer segredo conhecido que tenha escapado para o resumo.
      const bruto = readFileSync(summaryPath, "utf8");
      const limpo = mask(bruto, segredos);
      if (limpo !== bruto) writeFileSync(summaryPath, limpo, "utf8");
      const sum = JSON.parse(bruto) as K6Summary;

      // 3) Métricas e limites viram o resultado.
      const prefixo = cenarios.length > 1 ? `${cenario.name} · ` : "";
      const m = (k: string) => sum.metrics[k]?.values;
      const g = m("http_req_duration{qastage:mix}");
      const f = m("http_req_failed{qastage:mix}");
      const r = m("http_reqs{qastage:mix}");
      const arred = (n: number | undefined) => Math.round((n ?? 0) * 100) / 100;
      Object.assign(metrics, {
        [`${prefixo}requisições`]: r?.count ?? 0,
        [`${prefixo}vazão (req/s)`]: arred(r?.rate),
        [`${prefixo}erros (%)`]: arred((f?.rate ?? 0) * 100),
        [`${prefixo}média (ms)`]: arred(g?.avg),
        [`${prefixo}p95 (ms)`]: arred(g?.["p(95)"]),
        [`${prefixo}p99 (ms)`]: arred(g?.["p(99)"]),
      });
      const porEndpoint: string[] = [];
      for (const e of entries) {
        const d = m(`http_req_duration{endpoint:${e.ref}}`);
        const fe = m(`http_req_failed{endpoint:${e.ref}}`);
        metrics[`${prefixo}p95 ${e.ref} (ms)`] = arred(d?.["p(95)"]);
        porEndpoint.push(`${e.ref}: p95 ${arred(d?.["p(95)"])} ms · erros ${arred((fe?.rate ?? 0) * 100)}%`);
      }
      ctx.logger.info(`  ${r?.count ?? 0} requisições · ${arred(r?.rate)} req/s · p95 ${arred(g?.["p(95)"])} ms · erros ${arred((f?.rate ?? 0) * 100)}%`);

      const duracao = sum.state?.testRunDurationMs ?? Date.now() - t0;
      const reprovados: string[] = [];
      for (const { step: s, threshold: t } of passos) {
        if (!t) {
          steps.push({ name: nome(s), scenario: cenario.name, status: "passed", durationMs: /usuários/.test(s.text) ? Math.round(duracao) : 0 });
          continue;
        }
        const metrica = sum.metrics[t.metric.includes("{") ? t.metric : `${t.metric}{qastage:mix}`];
        const ok = metrica?.thresholds?.[t.expr]?.ok ?? false;
        const v = metrica?.values?.[t.stat];
        const medido = v === undefined ? "sem dados" : t.unit === "%" ? `${arred(v * 100)}%` : t.unit === "req/s" ? `${arred(v)} req/s` : `${arred(v)} ms`;
        const res: StepResult = { name: `${nome(s)} — medido: ${medido}`, scenario: cenario.name, status: ok ? "passed" : "failed", durationMs: 0 };
        if (!ok) {
          res.error = `Limite reprovado: ${t.label} — medido: ${medido}`;
          reprovados.push(res.error);
        }
        steps.push(res);
      }
      if (reprovados.length) {
        failures.push({
          scenario: cenario.name,
          step: reprovados.length === 1 ? reprovados[0]! : `${reprovados.length} limites reprovados`,
          error: reprovados.join("\n"),
          url: apiUrl(ctx),
          data: { carga: desc, mix: entries.map((e) => `${e.ref}×${e.weight}`).join(", "), espera: `${plan.thinkTime}s` },
          stepsToReproduce: cenario.steps.map((s) => `${s.keyword}${s.text}`),
          console: porEndpoint,
          artifacts: arquivos,
        });
      }
    }

    const status = failures.length ? "failed" : "passed";
    return { status, steps, artifacts, failures, metrics, ...(failures[0] ? { error: failures[0].error } : {}) };
  }
}

/** Roda o k6 e devolve código de saída + saída combinada. Código 99 = limites reprovados (normal). */
function runK6(script: string, env: Record<string, string>): Promise<{ code: number; output: string }> {
  const bin = process.env.QASTAGE_K6_BIN ?? "k6";
  const args = ["run", "--quiet", "--no-color", ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]), script];
  return new Promise((ok, falha) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    proc.stdout.on("data", (d) => (output += d));
    proc.stderr.on("data", (d) => (output += d));
    proc.on("error", (e: NodeJS.ErrnoException) =>
      falha(e.code === "ENOENT" ? new Error(`k6 não encontrado ("${bin}"). Instale: brew install k6 (ou defina QASTAGE_K6_BIN).`) : e),
    );
    proc.on("close", (code) => ok({ code: code ?? 1, output }));
  });
}
