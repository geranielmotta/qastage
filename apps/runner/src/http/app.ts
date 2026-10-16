import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { AcessoNegado } from "../auth/access";
import { usuarioDaSessao } from "../db/sessoes";
import { COOKIE, type Contexto } from "./contexto";
import { rotasAdmin } from "./rotas/admin";
import { rotasArquivos } from "./rotas/arquivos";
import { rotasAuth } from "./rotas/auth";
import { rotasExecucoes } from "./rotas/execucoes";
import { rotasPlugins } from "./rotas/plugins";
import { rotasProjetos } from "./rotas/projetos";

/**
 * Monta a API do runner (sem abrir porta): o server.ts chama listen, os testes
 * usam app.inject. Toda rota exige sessão, exceto as marcadas como públicas.
 */
export async function buildApp(ctx: Contexto, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 2 * 1024 * 1024,
    // Campo não declarado no schema é recusado (o padrão do Fastify é remover em silêncio).
    ajv: { customOptions: { removeAdditional: false } },
  });

  // Com cookie de sessão, CORS nunca pode ser "*": só as origens do shell e dos painéis.
  await app.register(cors, {
    origin: (origem, cb) => cb(null, !origem || ctx.origens.has(origem)),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });
  await app.register(cookie);

  app.decorateRequest("usuario", null);

  app.addHook("onRequest", async (req, reply) => {
    // Escrita só com JSON: formulário de outro site não consegue mandar (exige preflight do CORS).
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !String(req.headers["content-type"] ?? "").startsWith("application/json")) {
      return reply.code(415).send({ error: "Use content-type: application/json" });
    }
    if (req.method === "OPTIONS") return;
    req.usuario = (await usuarioDaSessao(req.cookies[COOKIE])) ?? null;
    if (!req.usuario && !req.routeOptions.config.publica) return reply.code(401).send({ error: "Não autenticado" });
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AcessoNegado) return reply.code(err.status).send({ error: err.message });
    if (err.validation) return reply.code(400).send({ error: `Dados inválidos: ${err.message}` });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    // Erro de banco/sistema (tem "code" do driver): 500 sem vazar detalhe interno.
    if ((err as { code?: string }).code && !err.statusCode) {
      req.log.error(err);
      return reply.code(500).send({ error: "Erro interno. Veja o log do runner." });
    }
    const msg = err.message;
    // Regras de negócio (validação, caminho fora do projeto...) chegam como Error simples.
    return reply.code(/^(Plugin|Projeto ".*") não encontrado/.test(msg) ? 404 : 400).send({ error: msg });
  });

  await app.register(async (a) => rotasAuth(a, ctx));
  await app.register(async (a) => rotasAdmin(a));
  await app.register(async (a) => rotasProjetos(a, ctx));
  await app.register(async (a) => rotasExecucoes(a, ctx));
  await app.register(async (a) => rotasArquivos(a, ctx));
  await app.register(async (a) => rotasPlugins(a, ctx));
  return app;
}
