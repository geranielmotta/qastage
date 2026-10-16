import { resolve, sep } from "node:path";
import type { PluginApiRoute, ProjectRef } from "@qastage/core-contract";
import { MapStore, type ManualLocator } from "./screen-map";
import { uiSteps } from "./steps";

/** A pasta de mapas vem do painel: relativa ao projeto e só dentro dele (ou da raiz, sem projeto). */
function mapsDir(raw: unknown, project?: ProjectRef): string {
  const raiz = project?.dir ?? process.cwd();
  const dir = resolve(raiz, typeof raw === "string" && raw ? raw : "qastage/maps");
  if (dir !== raiz && !dir.startsWith(raiz + sep)) throw new Error(`Pasta de mapas fora do projeto: ${dir}`);
  return dir;
}

const CHAVES = ["css", "testid", "text", "xpath"] as const;

/** Rotas do ui-testing montadas em /api/plugins/ui-testing/... */
export const uiRoutes: PluginApiRoute[] = [
  {
    method: "GET",
    path: "/steps",
    handle: async () => uiSteps.list(),
  },
  {
    method: "GET",
    path: "/exceptions",
    handle: async ({ query, project }) => new MapStore(mapsDir(query.maps, project)).readExceptions(),
  },
  {
    // Body: { maps, tela, rotulo, locator: { css | testid | text | xpath } }
    method: "PUT",
    path: "/exceptions",
    handle: async ({ body, project }) => {
      const b = (body ?? {}) as { maps?: string; tela?: string; rotulo?: string; locator?: Record<string, unknown> };
      if (!b.tela || !b.rotulo) throw new Error("Campos obrigatórios: tela, rotulo");
      const locator: ManualLocator = {};
      for (const k of CHAVES) {
        const v = b.locator?.[k];
        if (typeof v === "string" && v.trim()) locator[k] = v.trim();
      }
      if (Object.keys(locator).length !== 1) throw new Error(`Informe exatamente um localizador: ${CHAVES.join(", ")}`);
      const file = new MapStore(mapsDir(b.maps, project)).setException(b.tela, b.rotulo, locator);
      return { ok: true, file };
    },
  },
];
