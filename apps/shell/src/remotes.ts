import { loadRemote, registerRemotes } from "@module-federation/runtime";
import type { PanelProps, WebRemote } from "@qastage/core-contract";
import type { ComponentType } from "react";

const registrados = new Set<string>();

/** Registra o remote do plugin (vindo do manifesto) e carrega o painel exposto. */
export async function loadPanel(remote: WebRemote): Promise<ComponentType<PanelProps>> {
  if (!registrados.has(remote.name)) {
    registerRemotes([{ name: remote.name, entry: remote.entry, type: "module" }]);
    registrados.add(remote.name);
  }
  const id = `${remote.name}/${remote.module.replace(/^\.\//, "")}`;
  const mod = await loadRemote<{ default: ComponentType<PanelProps> }>(id);
  if (!mod?.default) throw new Error(`O remote ${id} não exporta um painel padrão.`);
  return mod.default;
}
