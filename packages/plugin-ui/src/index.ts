import type { RunnerPlugin } from "@qastage/core-contract";
import { UiExecutor } from "./runner/executor";

export { listSteps } from "./runner/steps";
export { slugify } from "./runner/text";
export type { ScreenMap, ManualLocator, ExceptionsFile } from "./runner/screen-map";

/**
 * A metade "runner" do plugin ui-testing: executa .feature de tela com
 * Playwright, resolvendo cada rótulo pela cadeia testid → mapa → semântico,
 * com a exceção manual do QA como saída. Também escaneia telas (mode=scan).
 */
export const uiPlugin: RunnerPlugin = {
  manifest: {
    name: "ui-testing",
    version: "0.0.0",
    description: "Testes de tela: scan de data-testid, resolução de campos e passos de tela.",
  },
  createExecutor: () => new UiExecutor(),
};
