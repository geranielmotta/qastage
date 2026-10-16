import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import type { ProjectConfig, ProjectRef } from "@qastage/core-contract";
import { CONFIG_FILE, loadProjectConfig, validateConfig } from "./config";

/** Pasta padrão dos projetos: projetos/<id>/qastage.config.json */
export const projectsDir = () => resolve(process.env.QASTAGE_PROJECTS_DIR ?? "projetos");
/** Projetos que vivem fora (no repositório do próprio sistema): { "projetos": ["../portal/qa"] } */
export const REGISTRY_FILE = "qastage.projects.json";

export interface ProjectEntry extends ProjectRef {
  config?: ProjectConfig;
  /** Config inválida: o projeto aparece no dashboard com o erro, sem derrubar os outros. */
  error?: string;
}

/** Pastas de .feature por plugin (convenção). */
export const FEATURE_DIRS: Record<string, string> = {
  "ui-testing": "features/ui",
  "api-testing": "features/api",
  "load-testing": "features/carga",
};

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function entry(dir: string): ProjectEntry {
  const id = slug(basename(dir));
  try {
    const config = loadProjectConfig(join(dir, CONFIG_FILE))!;
    return { id, name: config.projeto, dir, config };
  } catch (e) {
    return { id, name: id, dir, error: (e as Error).message };
  }
}

/** Todos os projetos: os de projetos/ e os do registro. Lido a cada chamada (pasta nova aparece na hora). */
export function listProjects(): ProjectEntry[] {
  const dirs: string[] = [];
  const base = projectsDir();
  if (existsSync(base)) {
    for (const d of readdirSync(base, { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(join(base, d.name, CONFIG_FILE))) dirs.push(join(base, d.name));
    }
  }
  if (existsSync(REGISTRY_FILE)) {
    try {
      const reg = JSON.parse(readFileSync(REGISTRY_FILE, "utf8")) as { projetos?: string[] };
      for (const p of reg.projetos ?? []) if (existsSync(join(resolve(p), CONFIG_FILE))) dirs.push(resolve(p));
    } catch {
      /* registro inválido: ignora, os de projetos/ continuam */
    }
  }
  const vistos = new Set<string>();
  return dirs.map(entry).filter((p) => (vistos.has(p.id) ? false : (vistos.add(p.id), true)));
}

export function getProject(id: string): ProjectEntry {
  const p = listProjects().find((x) => x.id === id);
  if (!p) throw new Error(`Projeto "${id}" não encontrado. Disponíveis: ${listProjects().map((x) => x.id).join(", ") || "nenhum"}`);
  if (p.error) throw new Error(`Projeto "${id}" com config inválida:\n${p.error}`);
  return p;
}

/** Caminho de arquivo dentro do projeto; recusa escapar da pasta (../). */
export function insideProject(p: ProjectRef, rel: string): string {
  const abs = resolve(p.dir, rel);
  if (!abs.startsWith(p.dir + sep)) throw new Error(`Caminho fora do projeto: ${rel}`);
  return abs;
}

export interface FeatureFile {
  /** Relativo à pasta do projeto, com "/". */
  path: string;
  plugin: string;
  /** Linha "Funcionalidade:" do arquivo. */
  title: string;
  scenarios: number;
}

/** Os .feature do projeto, pela convenção de pastas (features/ui, features/api, features/carga). */
export function listFeatures(p: ProjectRef): FeatureFile[] {
  const out: FeatureFile[] = [];
  for (const [plugin, sub] of Object.entries(FEATURE_DIRS)) {
    const dir = join(p.dir, sub);
    if (!existsSync(dir)) continue;
    const walk = (d: string) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        const abs = join(d, f.name);
        if (f.isDirectory()) walk(abs);
        else if (f.name.endsWith(".feature")) {
          const txt = readFileSync(abs, "utf8");
          out.push({
            path: relative(p.dir, abs).split(sep).join("/"),
            plugin,
            title: txt.match(/^\s*(?:Funcionalidade|Feature|Característica):\s*(.+)$/m)?.[1]?.trim() ?? f.name,
            scenarios: (txt.match(/^\s*(?:Cenário|Cenario|Esquema do Cenário|Scenario)(?: Outline)?:/gm) ?? []).length,
          });
        }
      }
    };
    walk(dir);
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Lê/grava um .feature do projeto (só .feature, só dentro de features/). */
export function featureFile(p: ProjectRef, rel: string): string {
  if (!rel.endsWith(".feature") || !rel.replace(/\\/g, "/").startsWith("features/")) throw new Error("Só arquivos .feature dentro de features/");
  return insideProject(p, rel);
}

export interface NewProject {
  nome: string;
  front: string;
  api?: string;
  spec?: string;
}

/** Cria projetos/<id>/ com a config mínima e as pastas de features. Escrita e carga começam desligadas. */
export function createProject(n: NewProject): ProjectEntry {
  const nome = n.nome?.trim();
  if (!nome) throw new Error("Informe o nome do projeto");
  const id = slug(nome);
  if (!id) throw new Error("Nome do projeto precisa ter letras ou números");
  const dir = join(projectsDir(), id);
  if (existsSync(dir)) throw new Error(`Já existe um projeto em ${dir}`);

  const config: ProjectConfig = {
    projeto: nome,
    padrao: "qa",
    ambientes: { qa: { front: n.front?.trim(), ...(n.api?.trim() ? { api: n.api.trim() } : {}), escrita: false, carga: false } },
    plugins: {
      "ui-testing": { maps: "qastage/maps" },
      ...(n.spec?.trim() ? { "api-testing": { spec: n.spec.trim() }, "load-testing": { spec: n.spec.trim() } } : {}),
    },
  };
  const erros = validateConfig(config);
  if (erros.length) throw new Error(erros.join("\n").replace(/ambientes\.qa\./g, ""));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2) + "\n", "utf8");
  for (const sub of [...Object.values(FEATURE_DIRS), "qastage/maps"]) mkdirSync(join(dir, sub), { recursive: true });
  return entry(dir);
}
