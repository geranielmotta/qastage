import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { AstBuilder, GherkinClassicTokenMatcher, Parser, compile } from "@cucumber/gherkin";
import { IdGenerator, type GherkinDocument, type Pickle } from "@cucumber/messages";
import type { Artifact, Executor, RunContext, RunResult, StepResult } from "@qastage/core-contract";
import { chromium, firefox, webkit, type Browser, type BrowserType } from "playwright";
import { ElementNotFoundError, ElementResolver } from "./resolver";
import { scanPage } from "./scan";
import { MapStore } from "./screen-map";
import { matchStep, type StepWorld } from "./steps";
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
}

function readParams(ctx: RunContext): UiParams {
  const p = ctx.params ?? {};
  const str = (k: string) => (p[k] === undefined ? undefined : String(p[k]));
  const browser = str("browser") ?? "chromium";
  if (!["chromium", "firefox", "webkit"].includes(browser)) throw new Error(`Navegador inválido: ${browser}`);
  return {
    mode: str("mode") === "scan" ? "scan" : "run",
    paths: (str("paths") ?? "/").split(",").map((s) => s.trim()).filter(Boolean),
    mapsDir: resolve(str("maps") ?? "qastage/maps"),
    browser: browser as UiParams["browser"],
    headed: str("headed") === "true",
    timeoutMs: Number(str("timeout") ?? 5000),
    testIdAttribute: str("testIdAttribute") ?? "data-testid",
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
    const { pickles, keywords } = parseFeature(resolve(ctx.featurePath));
    const resolver = new ElementResolver(new MapStore(params.mapsDir), params.testIdAttribute, params.timeoutMs);

    const steps: StepResult[] = [];
    const artifacts: Artifact[] = [];
    const resolucoes: Array<Record<string, string>> = [];

    for (const [i, pickle] of pickles.entries()) {
      ctx.logger.info(`Cenário: ${pickle.name}`);
      const prefixo = `${String(i + 1).padStart(2, "0")}-${slugify(pickle.name)}`;
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(params.timeoutMs);
      const world: StepWorld = { page, baseUrl: ctx.env.baseUrl, resolver, logger: ctx.logger, resolutions: [], timeoutMs: params.timeoutMs };

      let falhou = false;
      for (const ps of pickle.steps) {
        const nome = `${pickle.name} › ${keywords.get(ps.astNodeIds[0]!) ?? ""}${ps.text}`;
        if (falhou) {
          steps.push({ name: nome, status: "skipped", durationMs: 0 });
          continue;
        }
        const t0 = Date.now();
        try {
          const m = matchStep(ps.text);
          await m.run(world, ...m.args);
          steps.push({ name: nome, status: "passed", durationMs: Date.now() - t0 });
        } catch (e) {
          falhou = true;
          const error = (e as Error).message;
          const falha: StepResult = { name: nome, status: "failed", durationMs: Date.now() - t0, error };
          if (e instanceof ElementNotFoundError) {
            falha.details = { kind: "elemento-nao-encontrado", rotulo: e.rotulo, tela: e.screen, tentativas: e.tentativas };
          }
          steps.push(falha);
          ctx.logger.error(`  ${nome}\n${error}`);
        }
      }

      const print = join(ctx.artifactsDir, `${prefixo}-${falhou ? "falha" : "fim"}.png`);
      await page.screenshot({ path: print, fullPage: true }).catch(() => undefined);
      artifacts.push({ kind: "screenshot", path: print, label: `${pickle.name} (${falhou ? "falha" : "fim"})` });
      for (const r of world.resolutions) {
        resolucoes.push({ cenario: pickle.name, tela: r.screen, rotulo: r.rotulo, estrategia: r.strategy, como: r.detail });
      }
      await context.close();
    }

    const arqResolucoes = join(ctx.artifactsDir, "resolucoes.json");
    writeFileSync(arqResolucoes, JSON.stringify(resolucoes, null, 2) + "\n", "utf8");
    artifacts.push({ kind: "report", path: arqResolucoes, label: "como cada campo foi resolvido" });

    const falha = steps.find((s) => s.status === "failed");
    return falha ? { status: "failed", steps, artifacts, error: falha.error } : { status: "passed", steps, artifacts };
  }
}

/** Lê o .feature (qualquer idioma do Gherkin, ex.: "# language: pt") e expande em pickles. */
function parseFeature(path: string): { pickles: readonly Pickle[]; keywords: Map<string, string> } {
  const newId = IdGenerator.incrementing();
  const doc: GherkinDocument = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher()).parse(readFileSync(path, "utf8"));
  const pickles = compile(doc, path, newId);

  // O pickle perde a palavra-chave (Dado/Quando/Então); recuperamos pelo id do passo no AST.
  const keywords = new Map<string, string>();
  const visitar = (filhos: ReadonlyArray<{ background?: { steps: readonly { id: string; keyword: string }[] }; scenario?: { steps: readonly { id: string; keyword: string }[] }; rule?: { children: readonly unknown[] } }>) => {
    for (const f of filhos) {
      for (const s of [...(f.background?.steps ?? []), ...(f.scenario?.steps ?? [])]) keywords.set(s.id, s.keyword);
      if (f.rule) visitar(f.rule.children as typeof filhos);
    }
  };
  visitar(doc.feature?.children ?? []);
  return { pickles, keywords };
}
