import type { RunnerPlugin } from "@qastage/core-contract";
import { UiExecutor } from "./runner/executor";
import { uiRoutes } from "./runner/routes";

export { uiSteps } from "./runner/steps";
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
    webRemote: {
      name: "qastage_ui",
      entry: process.env.QASTAGE_UI_REMOTE ?? "http://localhost:5174/remoteEntry.js",
      module: "./Panel",
      title: "Telas (UI)",
      route: "/ui",
    },
  },
  createExecutor: () => new UiExecutor(),
  routes: uiRoutes,
};
