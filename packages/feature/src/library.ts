import { CucumberExpression, ParameterTypeRegistry } from "@cucumber/cucumber-expressions";

export type StepFn<W> = (world: W, args: string[], table?: string[][]) => Promise<void>;

export interface MatchedStep<W> {
  pattern: string;
  args: string[];
  run: StepFn<W>;
}

/**
 * Vocabulário fechado de passos de um plugin. Cada plugin cria o seu e
 * registra os passos com Cucumber Expressions ("eu clico em {string}").
 */
export class StepLibrary<W> {
  private readonly registry = new ParameterTypeRegistry();
  private readonly defs: Array<{ pattern: string; expression: CucumberExpression; run: StepFn<W> }> = [];

  step(pattern: string, run: StepFn<W>): this {
    this.defs.push({ pattern, expression: new CucumberExpression(pattern, this.registry), run });
    return this;
  }

  /** Acha o passo que casa com o texto; erro claro se nenhum ou vários. */
  match(texto: string): MatchedStep<W> {
    const achados = this.defs.map((d) => ({ d, args: d.expression.match(texto) })).filter((x) => x.args !== null);
    if (achados.length === 0) {
      throw new Error(`Passo não reconhecido: "${texto}".\nPassos disponíveis:\n${this.list().map((p) => `  - ${p}`).join("\n")}`);
    }
    if (achados.length > 1) {
      throw new Error(`Passo ambíguo: "${texto}" casa com ${achados.map((x) => `"${x.d.pattern}"`).join(", ")}`);
    }
    const { d, args } = achados[0]!;
    return { pattern: d.pattern, args: args!.map((a) => String(a.getValue(null))), run: d.run };
  }

  list(): string[] {
    return this.defs.map((d) => d.pattern);
  }
}
