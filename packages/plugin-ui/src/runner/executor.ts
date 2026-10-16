import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { mask, parseFeature } from "@qastage/feature";
import type { Artifact, Executor, FailureReport, RunContext, RunResult, StepResult } from "@qastage/core-contract";
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from "playwright";
import { ElementNotFoundError, ElementResolver } from "./resolver";
import { scanPage } from "./scan";
import { MapStore } from "./screen-map";
import { sensitiveValue, uiSteps, type StepWorld } from "./steps";
import { slugify } from "./text";

/** Parâmetros aceitos pelo plugin (vêm de RunContext.params). */
interface UiParams {
  /** "run" (padrão) executa o .feature; "scan" lê as telas e grava os mapas. */
  mode: "run" | "scan";
  /** Telas a escanear, separadas por vírgula (modo scan). Ex.: "/login,/painel". */
  paths: string[];
  /** Pasta dos mapas por tela + exceptions.json. */
  mapsDir: string;
  browser: "chromium" | "firefox" | "webkit";
  headed: boolean;
  timeoutMs: number;
  testIdAttribute: string;
  /** "steps" (padrão): print a cada passo, documentação viva; "failure": só na falha. */
  screenshots: "steps" | "failure";
  /** "failure" (padrão): grava o trace do Playwright quando o cenário falha; "off": não grava. */
  trace: "failure" | "off";
}

function readParams(ctx: RunContext): UiParams {
  const p = ctx.params ?? {};
  const str = (k: string) => (p[k] === undefined ? undefined : String(p[k]));
  const browser = str("browser") ?? "chromium";
  if (!["chromium", "firefox", "webkit"].includes(browser)) throw new Error(`Navegador inválido: ${browser}`);
  return {
    mode: str("mode") === "scan" ? "scan" : "run",
    paths: (str("paths") ?? "/").split(",").map((s) => s.trim()).filter(Boolean),
    mapsDir: resolve(ctx.project?.dir ?? process.cwd(), str("maps") ?? "qastage/maps"),
    browser: browser as UiParams["browser"],
    headed: str("headed") === "true",
    timeoutMs: Number(str("timeout") ?? 5000),
    testIdAttribute: str("testIdAttribute") ?? "data-testid",
    screenshots: str("screenshots") === "failure" ? "failure" : "steps",
    trace: str("trace") === "off" ? "off" : "failure",
  };
}

const browsers: Record<UiParams["browser"], BrowserType> = { chromium, firefox, webkit };

export class UiExecutor implements Executor {
  async run(ctx: RunContext): Promise<RunResult> {
    const startedAt = new Date().toISOString();
    const params = readParams(ctx);
    const browser = await browsers[params.browser].launch({ headless: !params.headed });
    try {
      const parcial = params.mode === "scan" ? await this.scan(ctx, params, browser) : await this.runFeature(ctx, params, browser);
      return { ...parcial, startedAt, finishedAt: new Date().toISOString() };
    } catch (e) {
      return { status: "error", error: (e as Error).message, artifacts: [], startedAt, finishedAt: new Date().toISOString() };
    } finally {
      await browser.close();
    }
  }

  /** Abre cada tela, lê o DOM e grava o mapa por tela. */
  private async scan(ctx: RunContext, params: UiParams, browser: Browser): Promise<Omit<RunResult, "startedAt" | "finishedAt">> {
    const store = new MapStore(params.mapsDir);
    const page = await browser.newPage();
    const steps: StepResult[] = [];
    const artifacts: Artifact[] = [];

    for (const caminho of params.paths) {
      const t0 = Date.now();
      const url = ctx.env.baseUrl.replace(/\/+$/, "") + "/" + caminho.replace(/^\/+/, "");
      try {
        await page.goto(url, { waitUntil: "networkidle" });
        const map = await scanPage(page, params.testIdAttribute);
        const file = store.saveMap(map);
        artifacts.push({ kind: "report", path: file, label: `mapa da tela ${map.screen}` });
        ctx.logger.info(`scan ${caminho}: ${map.elements.length} com testid, ${map.missingTestid.length} sem`);
        for (const m of map.missingTestid) {
          ctx.logger.warn(`  sem testid: <${m.tag}> "${m.label ?? "?"}"${m.suggestedTestid ? ` → sugerido ${params.testIdAttribute}="${m.suggestedTestid}"` : ""}`);
        }
        steps.push({ name: `scan ${caminho} → ${relative(process.cwd(), file)}`, status: "passed", durationMs: Date.now() - t0 });
      } catch (e) {
        const error = (e as Error).message;
        ctx.logger.error(`scan ${caminho}: ${error}`);
        steps.push({ name: `scan ${caminho}`, status: "failed", durationMs: Date.now() - t0, error });
      }
    }
    const falha = steps.find((s) => s.status !== "passed");
    return falha ? { status: "failed", steps, artifacts, error: falha.error } : { status: "passed", steps, artifacts };
  }

  /** Executa cada cenário do .feature num contexto de navegador limpo. */
  private async runFeature(ctx: RunContext, params: UiParams, browser: Browser): Promise<Omit<RunResult, "startedAt" | "finishedAt">> {
    if (!ctx.featurePath) throw new Error("Informe o .feature: --feature caminho/arquivo.feature");
    const cenarios = parseFeature(resolve(ctx.featurePath));
    const resolver = new ElementResolver(new MapStore(params.mapsDir), params.testIdAttribute, params.timeoutMs);

    const steps: StepResult[] = [];
    const artifacts: Artifact[] = [];
    const failures: FailureReport[] = [];
    const resolucoes: Array<Record<string, string>> = [];

    for (const [i, pickle] of cenarios.entries()) {
      ctx.logger.info(`Cenário: ${pickle.name}`);
      // Cada cenário tem a sua pasta: 01-login-com-sucesso/03-....png
      const pasta = `${String(i + 1).padStart(2, "0")}-${slugify(pickle.name)}`;
      mkdirSync(join(ctx.artifactsDir, pasta), { recursive: true });
      const arquivo = (nome: string) => join(ctx.artifactsDir, pasta, nome);

      const context = await browser.newContext();
      if (params.trace === "failure") await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      const page = await context.newPage();
      page.setDefaultTimeout(params.timeoutMs);
      const consoleAlvo = captureConsole(page);
      const world: StepWorld = { page, baseUrl: ctx.env.baseUrl, resolver, logger: ctx.logger, resolutions: [], data: {}, secrets: new Set(), timeoutMs: params.timeoutMs };

      let falha: FailureReport | undefined;
      const roteiro: string[] = [];
      for (const [n, ps] of pickle.steps.entries()) {
        // O segredo entra no conjunto antes do passo rodar: nem o nome do passo o carrega.
        const segredo = sensitiveValue(ps.text);
        if (segredo) world.secrets.add(segredo);
        const passo = mask(`${ps.keyword}${ps.text}`, world.secrets);
        const base = { name: `${pickle.name} › ${passo}`, scenario: pickle.name };
        if (falha) {
          steps.push({ ...base, status: "skipped", durationMs: 0 });
          continue;
        }
        roteiro.push(passo);
        const t0 = Date.now();
        const print = arquivo(`${String(n + 1).padStart(2, "0")}-${slugify(mask(ps.text, world.secrets)).slice(0, 60)}.png`);
        try {
          const m = uiSteps.match(ps.text);
          await m.run(world, m.args, ps.table);
          const r: StepResult = { ...base, status: "passed", durationMs: Date.now() - t0 };
          if (params.screenshots === "steps" && (await shot(page, print))) r.artifacts = [{ kind: "screenshot", path: print, label: passo }];
          steps.push(r);
        } catch (e) {
          const error = mask((e as Error).message, world.secrets);
          ctx.logger.error(`  ${base.name}\n${error}`);
          const r: StepResult = { ...base, status: "failed", durationMs: Date.now() - t0, error };
          if (e instanceof ElementNotFoundError) {
            r.details = { kind: "elemento-nao-encontrado", rotulo: e.rotulo, tela: e.screen, tentativas: e.tentativas };
          }
          const doPasso: Artifact[] = [];
          if (await shot(page, print)) doPasso.push({ kind: "screenshot", path: print, label: `${passo} (falha)` });
          r.artifacts = doPasso;
          steps.push(r);

          const html = arquivo("tela.html");
          const extras: Artifact[] = [...doPasso];
          if (await page.content().then((c) => (writeFileSync(html, c, "utf8"), true)).catch(() => false)) {
            extras.push({ kind: "other", path: html, label: "HTML da tela na falha" });
          }
          falha = {
            scenario: pickle.name,
            step: passo,
            error,
            url: page.url(),
            data: { ...world.data },
            stepsToReproduce: [...roteiro],
            console: consoleAlvo.map((l) => mask(l, world.secrets)),
            artifacts: extras,
          };
        }
      }

      if (params.trace === "failure") {
        if (falha) {
          const trace = arquivo("trace.zip");
          await context.tracing.stop({ path: trace });
          falha.artifacts.push({ kind: "trace", path: trace, label: "trace do Playwright (npx playwright show-trace)" });
        } else {
          await context.tracing.stop();
        }
      }
      if (falha) failures.push(falha);
      if (params.screenshots === "failure" && !falha) {
        const fim = arquivo("fim.png");
        if (await shot(page, fim)) artifacts.push({ kind: "screenshot", path: fim, label: `${pickle.name} (fim)` });
      }
      for (const r of world.resolutions) {
        resolucoes.push({ cenario: pickle.name, tela: r.screen, rotulo: r.rotulo, estrategia: r.strategy, como: r.detail });
      }
      await context.close();
    }

    const arqResolucoes = join(ctx.artifactsDir, "resolucoes.json");
    writeFileSync(arqResolucoes, JSON.stringify(resolucoes, null, 2) + "\n", "utf8");
    artifacts.push({ kind: "report", path: arqResolucoes, label: "como cada campo foi resolvido" });

    const status = failures.length > 0 ? "failed" : "passed";
    return { status, steps, artifacts, failures, ...(failures[0] ? { error: failures[0].error } : {}) };
  }
}

/** Print da página inteira; nunca derruba o passo se o print falhar. */
async function shot(page: Page, path: string): Promise<boolean> {
  return page.screenshot({ path, fullPage: true }).then(() => true, () => false);
}

/** Erros de console, exceções JS e requisições com falha do alvo — o que o dev precisa ver. */
function captureConsole(page: Page): string[] {
  const linhas: string[] = [];
  const hora = () => new Date().toISOString().slice(11, 23);
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") linhas.push(`${hora()} [console.${m.type()}] ${m.text()}`);
  });
  page.on("pageerror", (e) => linhas.push(`${hora()} [erro JS] ${e.message}`));
  page.on("requestfailed", (r) => linhas.push(`${hora()} [rede] ${r.method()} ${r.url()} — ${r.failure()?.errorText ?? "falhou"}`));
  page.on("response", (r) => {
    if (r.status() >= 400) linhas.push(`${hora()} [rede] ${r.request().method()} ${r.url()} → ${r.status()}`);
  });
  return linhas;
}
