import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { podeVerProjeto, projetoDoArquivo } from "./access";
import { alterarUsuario, buscarPorEmail, confereSenha, criarUsuario, hashSenha, listarUsuarios } from "./users";

// dataDir() lê a variável a cada chamada: definir aqui, antes dos testes, basta.
process.env.QASTAGE_DATA_DIR = mkdtempSync(join(tmpdir(), "qastage-users-"));

test("hash de senha: confere a certa, recusa a errada, sal diferente a cada vez", () => {
  const h = hashSenha("segredo123");
  assert.ok(confereSenha("segredo123", h));
  assert.equal(confereSenha("segredo124", h), false);
  assert.notEqual(h, hashSenha("segredo123"));
  assert.ok(!h.includes("segredo123"));
});

test("cadastro valida e-mail, senha mínima e duplicidade", () => {
  criarUsuario({ nome: "Admin", email: "Admin@Empresa.com", papel: "admin", senha: "12345678" });
  assert.equal(buscarPorEmail("admin@empresa.com")?.papel, "admin");
  assert.throws(() => criarUsuario({ nome: "X", email: "admin@empresa.com", papel: "qa", senha: "12345678" }), /Já existe/);
  assert.throws(() => criarUsuario({ nome: "X", email: "x@empresa", papel: "qa", senha: "12345678" }), /E-mail inválido/);
  assert.throws(() => criarUsuario({ nome: "X", email: "x@empresa.com", papel: "qa", senha: "curta" }), /8 caracteres/);
});

test("QA só vê projetos atribuídos; admin vê todos", () => {
  const qa = criarUsuario({ nome: "QA", email: "qa@empresa.com", papel: "qa", senha: "12345678", projetos: ["portal"] });
  assert.ok(podeVerProjeto(qa, "portal"));
  assert.equal(podeVerProjeto(qa, "financeiro"), false);
  assert.ok(podeVerProjeto(buscarPorEmail("admin@empresa.com")!, "financeiro"));
});

test("nunca fica sem admin ativo", () => {
  const admin = buscarPorEmail("admin@empresa.com")!;
  assert.throws(() => alterarUsuario(admin.id, { ativo: false }), /ao menos um administrador/);
  assert.throws(() => alterarUsuario(admin.id, { papel: "qa" }), /ao menos um administrador/);
  assert.equal(listarUsuarios().find((u) => u.id === admin.id)?.ativo, true);
});

test("arquivo pertence ao projeto pela pasta de artefatos ou do projeto", () => {
  const raiz = "/q";
  const projetos = [{ id: "portal", dir: "/q/projetos/portal" }];
  assert.equal(projetoDoArquivo("/q/artifacts/portal/ui-testing/1/report.html", raiz, projetos), "portal");
  assert.equal(projetoDoArquivo("/q/artifacts/_sem-projeto/x/1/report.html", raiz, projetos), undefined);
  assert.equal(projetoDoArquivo("/q/projetos/portal/qastage/maps/login.json", raiz, projetos), "portal");
  assert.equal(projetoDoArquivo("/q/package.json", raiz, projetos), undefined);
});
