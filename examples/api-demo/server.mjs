// API de demonstração do plugin api-testing (clientes, com login por token).
// Uso: node examples/api-demo/server.mjs [porta]   (padrão 4280)
// Spec em /openapi.json. Tem DOIS BUGS de propósito, para os testes acharem:
//   1. POST /clientes não valida o campo obrigatório "cep" (aceita sem ele);
//   2. GET /clientes/{id} devolve "telefone" como número (o contrato diz string).
// E uma degradação realista para o teste de carga: GET /clientes fica 1 ms mais
// lento a cada cliente cadastrado (busca sem índice), até 1 s.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const porta = Number(process.argv[2] ?? 4280);
const spec = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "openapi.json"));
const TOKEN = "token-demo-123";
const clientes = new Map();
let seq = 0;

const json = (res, status, body) =>
  body === undefined ? res.writeHead(status).end() : res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

async function lerJson(req) {
  const partes = [];
  for await (const c of req) partes.push(c);
  try {
    return JSON.parse(Buffer.concat(partes).toString("utf8") || "{}");
  } catch {
    return null;
  }
}

function cpfValido(v) {
  if (typeof v !== "string" || !/^\d{11}$/.test(v) || /^(\d)\1+$/.test(v)) return false;
  const n = v.split("").map(Number);
  const dv = (len) => {
    const s = n.slice(0, len).reduce((a, d, i) => a + d * (len + 1 - i), 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  return dv(9) === n[9] && dv(10) === n[10];
}

function validar(b) {
  if (!b || typeof b !== "object") return { mensagem: "JSON inválido" };
  for (const campo of ["nome", "email", "cpf"]) {
    // BUG 1: "cep" é obrigatório no contrato, mas ficou fora desta lista.
    if (b[campo] === undefined || b[campo] === null) return { mensagem: `Campo obrigatório: ${campo}`, campo };
  }
  for (const campo of ["nome", "email", "cpf", "cep", "telefone"]) {
    if (b[campo] !== undefined && typeof b[campo] !== "string") return { mensagem: `Tipo inválido: ${campo}`, campo };
  }
  if (b.limiteCredito !== undefined && (typeof b.limiteCredito !== "number" || b.limiteCredito < 0)) return { mensagem: "limiteCredito inválido", campo: "limiteCredito" };
  if (b.tipo !== undefined && !["PF", "PJ"].includes(b.tipo)) return { mensagem: "tipo inválido", campo: "tipo" };
  if (b.nome.length < 2) return { mensagem: "nome curto", campo: "nome" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return { mensagem: "e-mail inválido", campo: "email" };
  if (!cpfValido(b.cpf)) return { mensagem: "CPF inválido", campo: "cpf" };
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (p === "/openapi.json") return res.writeHead(200, { "content-type": "application/json" }).end(spec);

  if (p === "/auth/login" && req.method === "POST") {
    const b = await lerJson(req);
    if (b?.email === "qa@empresa.com" && b?.senha === "segredo") return json(res, 200, { accessToken: TOKEN });
    return json(res, 401, { mensagem: "Credenciais inválidas" });
  }

  if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { mensagem: "Token ausente ou inválido" });

  if (p === "/clientes" && req.method === "GET") {
    await new Promise((ok) => setTimeout(ok, Math.min(clientes.size, 1000)));
    const filtro = url.searchParams.get("nome")?.toLowerCase();
    return json(res, 200, [...clientes.values()].filter((c) => !filtro || c.nome.toLowerCase().includes(filtro)));
  }
  if (p === "/clientes" && req.method === "POST") {
    const b = await lerJson(req);
    const erro = validar(b);
    if (erro) return json(res, 400, erro);
    const c = { ...b, id: ++seq, criadoEm: new Date().toISOString() };
    clientes.set(c.id, c);
    return json(res, 201, c);
  }

  const m = p.match(/^\/clientes\/(\d+)$/);
  if (m) {
    const c = clientes.get(Number(m[1]));
    if (!c) return json(res, 404, { mensagem: "Cliente não encontrado" });
    if (req.method === "DELETE") return clientes.delete(c.id), json(res, 204);
    // BUG 2: telefone sai como número, quebrando o contrato (string).
    if (req.method === "GET") return json(res, 200, c.telefone ? { ...c, telefone: Number(c.telefone) } : c);
  }

  json(res, 404, { mensagem: "Rota não encontrada" });
}).listen(porta, () => console.log(`api-demo em http://localhost:${porta} (spec em /openapi.json)`));
