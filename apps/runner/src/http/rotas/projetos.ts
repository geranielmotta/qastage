import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { FastifyInstance } from "fastify";
import { exigirAdmin, exigirProjeto, podeVerProjeto } from "../../auth/access";
import { auditar } from "../../db/auditoria";
import { ultimasPorProjeto } from "../../db/execucoes";
import { CONFIG_FILE, loadProjectConfig, resolveEnv } from "../../config";
import { createProject, featureFile, getProject, listFeatures, listProjects, type NewProject } from "../../projects";
import { eu, quem, type Contexto } from "../contexto";

/** Projetos: dashboard, criação (admin), config resolvida e arquivos .feature. */
export async function rotasProjetos(app: FastifyInstance, ctx: Contexto): Promise<void> {
  app.get("/api/projects", async (req) => {
    const u = eu(req);
    const visiveis = listProjects().filter((p) => podeVerProjeto(u, p.id));
    const ultimas = await ultimasPorProjeto(visiveis.filter((p) => !p.error).map((p) => p.id));
    return visiveis.map((p) => {
      const base = { id: p.id, name: p.name, dir: relative(ctx.raiz, p.dir) || "." };
      if (p.error) return { ...base, error: p.error };
      const features = listFeatures(p);
      const porPlugin: Record<string, number> = {};
      for (const f of features) porPlugin[f.plugin] = (porPlugin[f.plugin] ?? 0) + f.scenarios;
      return {
        ...base,
        padrao: p.config!.padrao ?? Object.keys(p.config!.ambientes)[0],
        ambientes: Object.keys(p.config!.ambientes).map((n) => resolveEnv(p.config, n)),
        cenarios: porPlugin,
        arquivos: features.length,
        ultimas: (ultimas.get(p.id) ?? []).map((r) => ({ id: r.id, plugin: r.plugin, status: r.status, startedAt: r.startedAt, env: r.env.name, counts: r.counts })),
      };
    });
  });

  app.post<{ Body: NewProject }>(
    "/api/projects",
    {
      schema: {
        body: {
          type: "object",
          required: ["nome", "front"],
          properties: { nome: { type: "string" }, front: { type: "string" }, api: { type: "string" }, spec: { type: "string" } },
        },
      },
    },
    async (req, reply) => {
      exigirAdmin(eu(req));
      const p = createProject(req.body);
      await auditar("projeto_criado", quem(req), p.id, { nome: p.name }, req.ip);
      return reply.code(201).send({ id: p.id, name: p.name });
    },
  );

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req) => {
    exigirProjeto(eu(req), req.params.id);
    const p = getProject(req.params.id);
    return {
      id: p.id,
      name: p.name,
      padrao: p.config!.padrao ?? Object.keys(p.config!.ambientes)[0],
      ambientes: Object.keys(p.config!.ambientes).map((n) => resolveEnv(p.config, n)),
      plugins: p.config!.plugins ?? {},
    };
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/features", async (req) => {
    exigirProjeto(eu(req), req.params.id);
    return listFeatures(getProject(req.params.id));
  });

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>("/api/projects/:id/file", async (req, reply) => {
    exigirProjeto(eu(req), req.params.id);
    const file = featureFile(getProject(req.params.id), req.query.path ?? "");
    if (!existsSync(file)) return reply.code(404).send({ error: "Arquivo não encontrado" });
    return { path: req.query.path, text: readFileSync(file, "utf8") };
  });

  app.put<{ Params: { id: string }; Querystring: { path?: string }; Body: { text: string } }>(
    "/api/projects/:id/file",
    { schema: { body: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 1_000_000 } } } } },
    async (req) => {
      exigirProjeto(eu(req), req.params.id);
      const file = featureFile(getProject(req.params.id), req.query.path ?? "");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, req.body.text, "utf8");
      await auditar("arquivo_salvo", quem(req), `${req.params.id}/${req.query.path}`, undefined, req.ip);
      return { ok: true };
    },
  );

  // Config da raiz (modo sem projetos): só admin.
  app.get("/api/config", async (req, reply) => {
    exigirAdmin(eu(req));
    const cfg = loadProjectConfig();
    if (!cfg) return reply.code(404).send({ error: `Sem ${CONFIG_FILE} na raiz do projeto` });
    return {
      projeto: cfg.projeto,
      padrao: cfg.padrao ?? Object.keys(cfg.ambientes)[0],
      ambientes: Object.keys(cfg.ambientes).map((n) => resolveEnv(cfg, n)),
      plugins: cfg.plugins ?? {},
    };
  });
}
