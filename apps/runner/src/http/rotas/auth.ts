import type { FastifyInstance } from "fastify";
import { bloqueado, limparFalhas, registrarFalha } from "../../auth/limite";
import { confereSenha } from "../../auth/senha";
import { auditar } from "../../db/auditoria";
import { abrirSessao, DURACAO_MS, fecharSessao, fecharSessoesDe } from "../../db/sessoes";
import { alterarUsuario, buscarPorEmail, contarUsuarios, criarUsuario, publico } from "../../db/usuarios";
import { COOKIE, cookieDeSessao, eu, quem, type Contexto } from "../contexto";

const credenciais = {
  type: "object",
  required: ["email", "senha"],
  properties: { email: { type: "string", maxLength: 254 }, senha: { type: "string", maxLength: 200 } },
} as const;

/** Sessão: login, logout, quem sou eu, primeiro acesso e troca da própria senha. */
export async function rotasAuth(app: FastifyInstance, ctx: Contexto): Promise<void> {
  const publica = { config: { publica: true } };
  const maxAge = DURACAO_MS / 1000;

  app.post<{ Body: { email: string; senha: string } }>("/api/auth/login", { ...publica, schema: { body: credenciais } }, async (req, reply) => {
    const login = req.body.email.trim().toLowerCase();
    const espera = bloqueado(login);
    if (espera) return reply.code(429).send({ error: `Muitas tentativas. Tente de novo em ${espera} s.` });
    const u = await buscarPorEmail(login);
    // Mesma resposta para e-mail inexistente e senha errada: não revela quem tem conta.
    if (!u || !u.ativo || !confereSenha(req.body.senha, u.senhaHash)) {
      registrarFalha(login);
      await auditar("login_falhou", { email: login }, undefined, undefined, req.ip);
      return reply.code(401).send({ error: "E-mail ou senha incorretos." });
    }
    limparFalhas(login);
    cookieDeSessao(reply, await abrirSessao(u.id), ctx.cookieSeguro, maxAge);
    await auditar("login", { id: u.id, email: u.email }, undefined, undefined, req.ip);
    return { usuario: publico(u) };
  });

  app.post("/api/auth/logout", publica, async (req, reply) => {
    await fecharSessao(req.cookies[COOKIE]);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", publica, async (req, reply) => {
    if (req.usuario) return { usuario: publico(req.usuario) };
    return reply.code(401).send({ error: "Não autenticado", setup: (await contarUsuarios()) === 0 });
  });

  app.post<{ Body: { nome: string; email: string; senha: string } }>(
    "/api/auth/setup",
    {
      ...publica,
      schema: { body: { type: "object", required: ["nome", "email", "senha"], properties: { nome: { type: "string" }, ...credenciais.properties } } },
    },
    async (req, reply) => {
      // Primeiro acesso: só enquanto não existe nenhum usuário.
      if ((await contarUsuarios()) > 0) return reply.code(403).send({ error: "O administrador já foi criado. Entre com login." });
      const u = await criarUsuario({ ...req.body, papel: "admin" });
      cookieDeSessao(reply, await abrirSessao(u.id), ctx.cookieSeguro, maxAge);
      await auditar("setup_admin", { id: u.id, email: u.email }, u.email, undefined, req.ip);
      return reply.code(201).send({ usuario: publico(u) });
    },
  );

  app.post<{ Body: { atual: string; nova: string } }>(
    "/api/auth/senha",
    { schema: { body: { type: "object", required: ["atual", "nova"], properties: { atual: { type: "string" }, nova: { type: "string" } } } } },
    async (req, reply) => {
      const u = eu(req);
      if (!confereSenha(req.body.atual, u.senhaHash)) return reply.code(400).send({ error: "Senha atual incorreta." });
      await alterarUsuario(u.id, { senha: req.body.nova });
      await fecharSessoesDe(u.id, req.cookies[COOKIE]); // outras sessões caem; esta segue
      await auditar("senha_trocada", quem(req), u.email, undefined, req.ip);
      return { ok: true };
    },
  );
}
