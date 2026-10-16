import assert from "node:assert/strict";
import { test } from "node:test";
import { confereSenha, hashSenha, senhaTemporaria, validarEmail, validarSenha } from "./senha";

test("hash de senha: confere a certa, recusa a errada, sal diferente a cada vez", () => {
  const h = hashSenha("segredo123");
  assert.ok(confereSenha("segredo123", h));
  assert.equal(confereSenha("segredo124", h), false);
  assert.notEqual(h, hashSenha("segredo123"));
  assert.ok(!h.includes("segredo123"));
});

test("validações de senha e e-mail", () => {
  assert.throws(() => validarSenha("curta"), /8 caracteres/);
  assert.equal(validarEmail("  Ana@Empresa.COM "), "ana@empresa.com");
  assert.throws(() => validarEmail("ana@empresa"), /E-mail inválido/);
  assert.equal(senhaTemporaria().length, 12);
});
