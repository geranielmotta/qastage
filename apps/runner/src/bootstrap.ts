import { examplePlugin } from "@qastage/plugin-example";
import { uiPlugin } from "@qastage/plugin-ui";
import { reportsPlugin } from "@qastage/reports";
import { PluginRegistry } from "./registry";

/**
 * Registro estático dos plugins (F0). Mais à frente isto vira carga dinâmica a
 * partir de um manifesto, sem recompilar o runner — é o que torna o sistema
 * plugável. Por ora, basta registrar os plugins conhecidos.
 */
export function createRegistry(): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register(examplePlugin);
  registry.register(uiPlugin);
  registry.register(reportsPlugin);
  return registry;
}
