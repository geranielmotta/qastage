import { readFileSync } from "node:fs";
import { AstBuilder, GherkinClassicTokenMatcher, Parser, compile } from "@cucumber/gherkin";
import { IdGenerator, type GherkinDocument } from "@cucumber/messages";

/** Um passo pronto para executar: texto, palavra-chave e a tabela, se houver. */
export interface FeatureStep {
  /** "Dado ", "Quando ", "E "... (com o espaço, como no arquivo). */
  keyword: string;
  text: string;
  /** Tabela de dados do passo (| campo | valor |), linha a linha. */
  table?: string[][];
}

export interface FeatureScenario {
  name: string;
  steps: FeatureStep[];
}

type Filho = {
  background?: { steps: readonly { id: string; keyword: string }[] };
  scenario?: { steps: readonly { id: string; keyword: string }[] };
  rule?: { children: readonly unknown[] };
};

/**
 * Lê o .feature (qualquer idioma do Gherkin, ex.: "# language: pt") e expande
 * em cenários prontos: Contexto aplicado, Esquema do Cenário desdobrado.
 */
export function parseFeature(path: string): FeatureScenario[] {
  return parseFeatureText(readFileSync(path, "utf8"), path);
}

export function parseFeatureText(source: string, uri = "inline.feature"): FeatureScenario[] {
  const newId = IdGenerator.incrementing();
  const doc: GherkinDocument = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher()).parse(source);

  // O pickle perde a palavra-chave (Dado/Quando/Então); recuperamos pelo id do passo no AST.
  const keywords = new Map<string, string>();
  const visitar = (filhos: readonly Filho[]) => {
    for (const f of filhos) {
      for (const s of [...(f.background?.steps ?? []), ...(f.scenario?.steps ?? [])]) keywords.set(s.id, s.keyword);
      if (f.rule) visitar(f.rule.children as Filho[]);
    }
  };
  visitar(doc.feature?.children ?? []);

  return compile(doc, uri, newId).map((p) => ({
    name: p.name,
    steps: p.steps.map((s) => {
      const step: FeatureStep = { keyword: keywords.get(s.astNodeIds[0]!) ?? "", text: s.text };
      const rows = s.argument?.dataTable?.rows;
      if (rows) step.table = rows.map((r) => r.cells.map((c) => c.value));
      return step;
    }),
  }));
}
