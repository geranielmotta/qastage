import { sep } from "node:path";
import type { Usuario } from "./users";

/** Admin vê tudo; QA só os projetos atribuídos a ele. */
export function podeVerProjeto(u: Usuario, projetoId: string): boolean {
  return u.papel === "admin" || u.projetos.includes(projetoId);
}

export const ehAdmin = (u: Usuario) => u.papel === "admin";

/** Erro que vira 401/403 na API. */
export class AcessoNegado extends Error {
  constructor(
    msg: string,
    readonly status: 401 | 403 = 403,
  ) {
    super(msg);
  }
}

export function exigirProjeto(u: Usuario, projetoId: string): void {
  if (!podeVerProjeto(u, projetoId)) throw new AcessoNegado(`Sem acesso ao projeto "${projetoId}". Peça ao administrador.`);
}

export function exigirAdmin(u: Usuario): void {
  if (!ehAdmin(u)) throw new AcessoNegado("Só administradores.");
}

/**
 * De qual projeto é um arquivo? artifacts/<projeto>/... ou a pasta de um
 * projeto. undefined = fora de qualquer projeto (só admin acessa).
 */
export function projetoDoArquivo(abs: string, raiz: string, projetos: Array<{ id: string; dir: string }>): string | undefined {
  const artifacts = raiz + sep + "artifacts" + sep;
  if (abs.startsWith(artifacts)) {
    const id = abs.slice(artifacts.length).split(sep)[0];
    return id && id !== "_sem-projeto" ? id : undefined;
  }
  return projetos.find((p) => abs.startsWith(p.dir + sep))?.id;
}
