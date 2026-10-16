import type { FastifyInstance } from "fastify";
import { AcessoNegado, ehAdmin, exigirProjeto } from "../../auth/access";
import { getProject } from "../../projects";
import { eu, type Contexto } from "../contexto";

/** Manifestos e as rotas que cada plugin contribui (RunnerPlugin.routes). */
export async function rotasPlugins(app: FastifyInstance, ctx: Contexto): Promise<void> {
  app.get("/api/plugins", async () => ctx.registry.list().map((p) => p.manifest));

  app.route<{ Params: { nome: string; "*": string }; Querystring: Record<string, string> }>({
    method: ["GET", "POST", "PUT", "DELETE"],
    url: "/api/plugins/:nome/*",
    handler: async (req, reply) => {
      const u = eu(req);
      const plugin = ctx.registry.get(req.params.nome);
      const caminho = "/" + req.params["*"];
      const rota = plugin.routes?.find((r) => r.method === req.method && r.path === caminho);
      if (!rota) return reply.code(404).send({ error: "Rota não encontrada" });

      const pid = req.query.project;
      if (pid) exigirProjeto(u, pid);
      // Sem projeto, a rota pode enxergar dados de todos: QA só lê o vocabulário de passos.
      else if (!ehAdmin(u) && !(req.method === "GET" && caminho === "/steps")) throw new AcessoNegado("Informe o projeto (?project=<id>).");

      const proj = pid ? getProject(pid) : undefined;
      return rota.handle({
        query: req.query,
        body: req.body,
        ...(proj ? { project: { id: proj.id, name: proj.name, dir: proj.dir } } : {}),
      });
    },
  });
}
