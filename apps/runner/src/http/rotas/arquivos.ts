import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { artifactsDe, dentro, eu, exigirArquivo, type Contexto } from "../contexto";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".js": "text/plain; charset=utf-8",
  ".feature": "text/plain; charset=utf-8",
  ".webm": "video/webm",
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".zip": "application/zip",
};

function enviar(reply: FastifyReply, abs: string, base: string) {
  if (!dentro(abs, base) || !existsSync(abs) || !statSync(abs).isFile()) return reply.code(404).send({ error: "Arquivo não encontrado" });
  return reply.type(MIME[extname(abs)] ?? "application/octet-stream").send(createReadStream(abs));
}

/** Prints, mapas e relatórios: só de projetos visíveis ao usuário. */
export async function rotasArquivos(app: FastifyInstance, ctx: Contexto): Promise<void> {
  app.get<{ Querystring: { path?: string } }>("/api/files", async (req, reply) => {
    const abs = resolve(req.query.path ?? "");
    exigirArquivo(eu(req), abs, ctx.raiz);
    return enviar(reply, abs, ctx.raiz);
  });

  // Pasta de artefatos como site estático (report.html e seus links relativos).
  app.get<{ Params: { "*": string } }>("/artifacts/*", async (req, reply) => {
    const base = artifactsDe(ctx.raiz);
    const abs = resolve(base, "." + "/" + decodeURIComponent(req.params["*"]));
    exigirArquivo(eu(req), abs, ctx.raiz);
    return enviar(reply, abs, base);
  });
}
