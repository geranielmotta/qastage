// Site de demonstração do plugin ui-testing: /login e /painel.
// Uso: node examples/ui-demo/server.mjs [porta]   (padrão 4173)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "site");
const porta = Number(process.argv[2] ?? 4173);

createServer(async (req, res) => {
  const caminho = new URL(req.url, "http://x").pathname.replace(/^\/+|\/+$/g, "") || "login";
  try {
    const html = await readFile(join(site, `${caminho.replace(/[^a-z0-9-]/gi, "")}.html`));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
  } catch {
    res.writeHead(404).end("não encontrado");
  }
}).listen(porta, () => console.log(`ui-demo em http://localhost:${porta}`));
