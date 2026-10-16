import { join, sep } from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AcessoNegado, ehAdmin, podeVerProjeto, projetoDoArquivo } from "../auth/access";
import type { Usuario } from "../db/usuarios";
import { listProjects } from "../projects";
import type { PluginRegistry } from "../registry";

declare module "fastify" {
  interface FastifyRequest {
    /** Preenchido pelo hook de autenticação (rotas não públicas). */
    usuario: Usuario | null;
  }
  interface FastifyContextConfig {
    /** Rota acessível sem sessão (login, primeiro acesso). */
    publica?: boolean;
  }
}

export const COOKIE = "qastage_sessao";

/** Dependências das rotas: injetadas no buildApp (os testes passam as suas). */
export interface Contexto {
  registry: PluginRegistry;
  /** Raiz do QAStage (artefatos, projetos). */
  raiz: string;
  /** Origens do shell/painéis que podem chamar com a sessão. */
  origens: Set<string>;
  /** Cookie com flag Secure (produção com HTTPS). */
  cookieSeguro: boolean;
}

/** Usuário da requisição (rotas não públicas sempre têm). */
export function eu(req: FastifyRequest): Usuario {
  if (!req.usuario) throw new AcessoNegado("Não autenticado", 401);
  return req.usuario;
}

export function quem(req: FastifyRequest) {
  return req.usuario ? { id: req.usuario.id, email: req.usuario.email } : undefined;
}

/** Arquivo de execução/mapa: QA só de projetos atribuídos; fora de projeto, só admin. */
export function exigirArquivo(u: Usuario, abs: string, raiz: string): void {
  if (ehAdmin(u)) return;
  const projeto = projetoDoArquivo(abs, raiz, listProjects());
  if (!projeto || !podeVerProjeto(u, projeto)) throw new AcessoNegado("Sem acesso a este arquivo.");
}

export const artifactsDe = (raiz: string) => join(raiz, "artifacts");
export const dentro = (abs: string, base: string) => abs.startsWith(base + sep);

export function cookieDeSessao(reply: FastifyReply, token: string, seguro: boolean, maxAgeS: number): void {
  reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: maxAgeS, secure: seguro });
}
