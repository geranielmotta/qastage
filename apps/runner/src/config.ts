import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EnvConfig, ProjectConfig, ResolvedEnv } from "@qastage/core-contract";

export const CONFIG_FILE = "qastage.config.json";

/** Caminho da config: QASTAGE_CONFIG ou qastage.config.json na pasta atual (raiz do monorepo). */
export function configPath(): string {
  return resolve(process.env.QASTAGE_CONFIG ?? join(process.cwd(), CONFIG_FILE));
}

/**
 * Lê e valida a config a cada chamada (barato): editar o arquivo vale na
 * próxima execução, sem reiniciar o runner. Sem arquivo → undefined.
 */
export function loadProjectConfig(): ProjectConfig | undefined {
  const file = configPath();
  if (!existsSync(file)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file} não é um JSON válido: ${(e as Error).message}`);
  }
  const erros = validate(raw);
  if (erros.length) throw new Error(`${file} inválido:\n${erros.map((e) => `  - ${e}`).join("\n")}`);
  return raw as ProjectConfig;
}

function validate(raw: unknown): string[] {
  const erros: string[] = [];
  const c = raw as Partial<ProjectConfig>;
  if (!c || typeof c !== "object") return ["a config deve ser um objeto"];
  if (typeof c.projeto !== "string" || !c.projeto.trim()) erros.push('"projeto": informe o nome do projeto');
  if (!c.ambientes || typeof c.ambientes !== "object" || !Object.keys(c.ambientes).length) {
    erros.push('"ambientes": informe ao menos um, ex.: { "qa": { "front": "https://qa.exemplo.com" } }');
    return erros;
  }
  for (const [nome, a] of Object.entries(c.ambientes as Record<string, Partial<EnvConfig>>)) {
    const url = (k: "front" | "api" | "auth", obrigatorio: boolean) => {
      const v = a?.[k];
      if (v === undefined && !obrigatorio) return;
      try {
        if (!/^https?:$/.test(new URL(String(v)).protocol)) throw new Error();
      } catch {
        erros.push(`ambientes.${nome}.${k}: URL http(s) inválida (${JSON.stringify(v)})`);
      }
    };
    url("front", true);
    url("api", false);
    url("auth", false);
    for (const k of ["escrita", "carga"] as const) {
      if (a?.[k] !== undefined && typeof a[k] !== "boolean") erros.push(`ambientes.${nome}.${k}: use true ou false`);
    }
  }
  if (c.padrao !== undefined && !(c.padrao in c.ambientes)) erros.push(`"padrao": "${c.padrao}" não está em ambientes`);
  if (c.plugins !== undefined && (typeof c.plugins !== "object" || Array.isArray(c.plugins))) erros.push('"plugins": use { "<plugin>": { "<param>": valor } }');
  return erros;
}

export interface EnvOverrides {
  baseUrl?: string;
  apiUrl?: string;
  authUrl?: string;
}

/**
 * Resolve o ambiente pelo nome. Com config: vem dela (URLs podem ser
 * sobrescritas pela CLI). Sem config: comportamento antigo (URL pela CLI,
 * homolog só-leitura).
 */
export function resolveEnv(cfg: ProjectConfig | undefined, name: string | undefined, o: EnvOverrides = {}): ResolvedEnv {
  if (!cfg) {
    const n = name ?? "local";
    return {
      name: n,
      baseUrl: o.baseUrl ?? "http://localhost:3000",
      ...(o.apiUrl ? { apiUrl: o.apiUrl } : {}),
      ...(o.authUrl ? { authUrl: o.authUrl } : {}),
      writable: n !== "homolog",
    };
  }
  const n = name ?? cfg.padrao ?? Object.keys(cfg.ambientes)[0]!;
  const a = cfg.ambientes[n];
  if (!a) throw new Error(`Ambiente "${n}" não existe em ${CONFIG_FILE}. Disponíveis: ${Object.keys(cfg.ambientes).join(", ")}`);
  const api = o.apiUrl ?? a.api;
  const auth = o.authUrl ?? a.auth;
  return {
    name: n,
    baseUrl: o.baseUrl ?? a.front,
    ...(api ? { apiUrl: api } : {}),
    ...(auth ? { authUrl: auth } : {}),
    writable: a.escrita === true,
    allowLoad: a.carga === true,
  };
}

/** Padrões do plugin na config + o que veio no pedido (o pedido vence). */
export function pluginParams(cfg: ProjectConfig | undefined, plugin: string, params: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...(cfg?.plugins?.[plugin] ?? {}), ...params };
}
