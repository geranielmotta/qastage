import type { FastifyInstance } from "fastify";
import { exigirAdmin } from "../../auth/access";
import { senhaTemporaria } from "../../auth/senha";
import { auditar } from "../../db/auditoria";
import { fecharSessoesDe } from "../../db/sessoes";
import { alterarUsuario, criarUsuario, listarUsuarios, publico, type AlteracaoUsuario, type Papel } from "../../db/usuarios";
import { COOKIE, eu, quem } from "../contexto";

const projetos = { type: "array", items: { type: "string" }, maxItems: 500 } as const;

/** Administração de usuários (só admin). */
export async function rotasAdmin(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (req) => exigirAdmin(eu(req)));

  app.get("/api/admin/usuarios", async () => (await listarUsuarios()).map(publico));

  app.post<{ Body: { nome: string; email: string; papel?: Papel; projetos?: string[] } }>(
    "/api/admin/usuarios",
    {
      schema: {
        body: {
          type: "object",
          required: ["nome", "email"],
          properties: { nome: { type: "string" }, email: { type: "string" }, papel: { enum: ["admin", "qa"] }, projetos },
        },
      },
    },
    async (req, reply) => {
      const senha = senhaTemporaria();
      const u = await criarUsuario({ ...req.body, papel: req.body.papel ?? "qa", senha });
      await auditar("usuario_criado", quem(req), u.email, { papel: u.papel, projetos: u.projetos }, req.ip);
      // A senha temporária aparece só nesta resposta; o admin repassa ao usuário.
      return reply.code(201).send({ usuario: publico(u), senhaTemporaria: senha });
    },
  );

  app.patch<{ Params: { id: string }; Body: AlteracaoUsuario & { redefinirSenha?: boolean } }>(
    "/api/admin/usuarios/:id",
    {
      schema: {
        body: {
          type: "object",
          properties: { nome: { type: "string" }, papel: { enum: ["admin", "qa"] }, ativo: { type: "boolean" }, projetos, redefinirSenha: { type: "boolean" } },
          additionalProperties: false,
        },
      },
    },
    async (req) => {
      const { redefinirSenha, ...alteracao } = req.body;
      const novaSenha = redefinirSenha ? senhaTemporaria() : undefined;
      const u = await alterarUsuario(req.params.id, { ...alteracao, ...(novaSenha ? { senha: novaSenha } : {}) });
      // Desativar, mudar papel ou redefinir senha derruba as sessões abertas dessa pessoa.
      if (alteracao.ativo === false || alteracao.papel !== undefined || novaSenha) {
        await fecharSessoesDe(u.id, u.id === eu(req).id ? req.cookies[COOKIE] : undefined);
      }
      const { senha: _, ...registro } = alteracao as AlteracaoUsuario;
      await auditar("usuario_alterado", quem(req), u.email, { ...registro, ...(novaSenha ? { senhaRedefinida: true } : {}) }, req.ip);
      return { usuario: publico(u), ...(novaSenha ? { senhaTemporaria: novaSenha } : {}) };
    },
  );
}
