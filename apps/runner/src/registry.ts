import type { RunnerPlugin } from "@qastage/core-contract";

/** Registro em memória dos plugins conhecidos pelo runner. */
export class PluginRegistry {
  private readonly plugins = new Map<string, RunnerPlugin>();

  register(plugin: RunnerPlugin): void {
    const { name } = plugin.manifest;
    if (this.plugins.has(name)) {
      throw new Error(`Plugin já registrado: ${name}`);
    }
    this.plugins.set(name, plugin);
  }

  get(name: string): RunnerPlugin {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      const nomes = [...this.plugins.keys()].join(", ") || "nenhum";
      throw new Error(`Plugin não encontrado: "${name}". Disponíveis: ${nomes}`);
    }
    return plugin;
  }

  list(): RunnerPlugin[] {
    return [...this.plugins.values()];
  }
}
