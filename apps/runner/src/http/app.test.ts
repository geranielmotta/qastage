import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createRegistry } from "../bootstrap";
import { db, fecharDb } from "../db/conexao";
import { workspaceRoot } from "../execute";
import { buildApp } from "./app";

/**
 * A API inteira contra o Postgres de teste (NODE_ENV=test → qastage_test),
 * recriado do zero pelas migrations. Usa os projetos de demonstração do repo.
 */
let app: FastifyInstance;
const SHELL = "http://localhost:5173";

before(async () => {
  assert.equal(process.env.NODE_ENV, "test", "rode com NODE_ENV=test (pnpm test)");
  process.chdir(workspaceRoot());
  await db().migrate.rollback(undefined, true);
  await db().migrate.latest();
  app = await buildApp({ registry: createRegistry(), raiz: process.cwd(), origens: new Set([SHELL]), cookieSeguro: false });
});

after(async () => {
  await app.close();
  await fecharDb();
});

const cookieDe = (r: LightMyRequestResponse) => {
  const c = r.cookies.find((x) => x.name === "qastage_sessao");
  assert.ok(c, "esperava cookie de sessão");
  return `qastage_sessao=${c.value}`;
};
const json = { "content-type": "application/json" };
const pedir = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, cookie?: string, payload?: unknown) =>
  app.inject({ method, url, headers: { ...(payload !== undefined ? json : {}), ...(cookie ? { cookie } : {}) }, ...(payload !== undefined ? { payload: payload as object } : {}) });

let admin = "";
let qa = "";
let qaId = "";

test("primeiro acesso cria o admin uma única vez", async () => {
  const me = await pedir("GET", "/api/auth/me");
  assert.equal(me.statusCode, 401);
  assert.equal(me.json().setup, true);

  const r = await pedir("POST", "/api/auth/setup", undefined, { nome: "Ana Admin", email: "Ana@Empresa.com", senha: "senhaAdmin123" });
  assert.equal(r.statusCode, 201);
  admin = cookieDe(r);
  assert.equal(r.json().usuario.email, "ana@empresa.com");
  assert.equal(r.json().usuario.senhaHash, undefined, "hash nunca sai pela API");

  const de_novo = await pedir("POST", "/api/auth/setup", undefined, { nome: "X", email: "x@empresa.com", senha: "12345678" });
  assert.equal(de_novo.statusCode, 403);
});

test("admin cria QA com senha temporária e a QA entra", async () => {
  const r = await pedir("POST", "/api/admin/usuarios", admin, { nome: "Bruno QA", email: "bruno@empresa.com", papel: "qa", projetos: ["portal-demo"] });
  assert.equal(r.statusCode, 201);
  qaId = r.json().usuario.id;
  const login = await pedir("POST", "/api/auth/login", undefined, { email: "bruno@empresa.com", senha: r.json().senhaTemporaria });
  assert.equal(login.statusCode, 200);
  qa = cookieDe(login);
});

test("QA só enxerga e usa projetos atribuídos", async () => {
  assert.deepEqual((await pedir("GET", "/api/projects", qa)).json().map((p: { id: string }) => p.id), ["portal-demo"]);
  assert.deepEqual((await pedir("GET", "/api/projects", admin)).json().map((p: { id: string }) => p.id).sort(), ["api-clientes", "portal-demo"]);
  assert.equal((await pedir("GET", "/api/projects/api-clientes", qa)).statusCode, 403);
  assert.equal((await pedir("GET", "/api/projects/portal-demo", qa)).statusCode, 200);
  assert.equal((await pedir("GET", "/api/projects/api-clientes/features", qa)).statusCode, 403);
  assert.equal((await pedir("POST", "/api/runs", qa, { plugin: "example", project: "api-clientes", env: { name: "local" } })).statusCode, 403);
  assert.equal((await pedir("POST", "/api/runs", qa, { plugin: "example", env: { baseUrl: "http://x" } })).statusCode, 403);
  assert.equal((await pedir("GET", "/api/runs?project=api-clientes", qa)).statusCode, 403);
  assert.equal((await pedir("GET", "/api/plugins/ui-testing/steps", qa)).statusCode, 200);
  assert.equal((await pedir("GET", "/api/plugins/ui-testing/exceptions", qa)).statusCode, 403, "rota de plugin sem projeto");
  assert.equal((await pedir("GET", `/api/files?path=${process.cwd()}/projetos/api-clientes/qastage.config.json`, qa)).statusCode, 403);
  assert.equal((await pedir("GET", `/api/files?path=${process.cwd()}/package.json`, qa)).statusCode, 403);
});

test("funções de admin são negadas à QA", async () => {
  assert.equal((await pedir("GET", "/api/admin/usuarios", qa)).statusCode, 403);
  assert.equal((await pedir("POST", "/api/projects", qa, { nome: "Hack", front: "https://x.com" })).statusCode, 403);
});

test("execução fica no histórico do banco com quem pediu", async () => {
  const r = await pedir("POST", "/api/runs", qa, { plugin: "example", project: "portal-demo", env: { name: "local" } });
  assert.equal(r.statusCode, 202);
  const id = r.json().id as string;
  for (let i = 0; i < 50; i++) {
    const s = await pedir("GET", `/api/runs/${id}`, qa);
    if (s.json().state === "done") break;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  const hist = (await pedir("GET", "/api/runs?project=portal-demo", qa)).json();
  const linha = hist.find((h: { id: string }) => h.id === id);
  assert.equal(linha.status, "passed");
  assert.equal(linha.requestedBy, "Bruno QA");
  assert.match(linha.reportId, /^portal-demo\/example\//);
  // O dashboard mostra a última execução do projeto.
  const dash = (await pedir("GET", "/api/projects", qa)).json();
  assert.equal(dash[0].ultimas[0].id, id);
});

test("defesas: sem sessão, sem JSON, CORS e sessão guardada só como hash", async () => {
  assert.equal((await pedir("GET", "/api/projects")).statusCode, 401);
  const semJson = await app.inject({ method: "POST", url: "/api/projects", headers: { cookie: admin, "content-type": "text/plain" }, payload: "x" });
  assert.equal(semJson.statusCode, 415);
  const estranho = await app.inject({ method: "GET", url: "/api/auth/me", headers: { origin: "http://evil.com" } });
  assert.equal(estranho.headers["access-control-allow-origin"], undefined);
  const shell = await app.inject({ method: "GET", url: "/api/auth/me", headers: { origin: SHELL } });
  assert.equal(shell.headers["access-control-allow-origin"], SHELL);
  assert.equal(shell.headers["access-control-allow-credentials"], "true");

  const token = decodeURIComponent(qa.split("=")[1]!);
  const linhas = await db()("sessoes").select("token_hash");
  assert.ok(linhas.length >= 2);
  assert.ok(linhas.every((l) => l.token_hash !== token && /^[0-9a-f]{64}$/.test(l.token_hash)));
});

test("5 senhas erradas bloqueiam o login", async () => {
  for (let i = 0; i < 5; i++) await pedir("POST", "/api/auth/login", undefined, { email: "bruno@empresa.com", senha: "errada" });
  const r = await pedir("POST", "/api/auth/login", undefined, { email: "bruno@empresa.com", senha: "qualquer" });
  assert.equal(r.statusCode, 429);
});

test("desativar derruba a sessão; nunca fica sem admin; tudo auditado", async () => {
  assert.equal((await pedir("PATCH", `/api/admin/usuarios/${qaId}`, admin, { ativo: false })).statusCode, 200);
  assert.equal((await pedir("GET", "/api/projects", qa)).statusCode, 401);

  const me = (await pedir("GET", "/api/auth/me", admin)).json().usuario.id;
  const r = await pedir("PATCH", `/api/admin/usuarios/${me}`, admin, { papel: "qa" });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /ao menos um administrador/);
  assert.equal((await pedir("GET", "/api/auth/me", admin)).json().usuario.papel, "admin", "transação desfeita");

  const acoes = (await db()("auditoria").select("acao")).map((l) => l.acao);
  for (const a of ["setup_admin", "usuario_criado", "login", "login_falhou", "execucao_iniciada", "usuario_alterado"]) assert.ok(acoes.includes(a), `auditoria: ${a}`);
});

test("validação de corpo pelo schema do Fastify", async () => {
  const r = await pedir("PATCH", `/api/admin/usuarios/${qaId}`, admin, { papel: "chefe" });
  assert.equal(r.statusCode, 400);
  const extra = await pedir("PATCH", `/api/admin/usuarios/${qaId}`, admin, { senhaHash: "x" });
  assert.equal(extra.statusCode, 400, "campo desconhecido recusado");
});
