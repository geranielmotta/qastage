import assert from "node:assert/strict";
import { test } from "node:test";
import { br, Rng, valueForField } from "./index";

test("CPF e CNPJ gerados são válidos", () => {
  const rng = new Rng(42);
  for (let i = 0; i < 500; i++) {
    assert.ok(br.isValidCpf(br.cpf(rng)), "cpf");
    assert.ok(br.isValidCnpj(br.cnpj(rng, true)), "cnpj");
  }
});

test("validador recusa CPF conhecido como inválido", () => {
  assert.equal(br.isValidCpf("111.111.111-11"), false);
  assert.equal(br.isValidCpf("529.982.247-25"), true);
});

test("mesma semente, mesmos dados", () => {
  assert.equal(br.cpf(new Rng("cenario")), br.cpf(new Rng("cenario")));
});

test("preenchimento por nome de campo", () => {
  const rng = new Rng(1);
  assert.ok(br.isValidCpf(valueForField("cpfCliente", rng)!));
  assert.match(valueForField("email", rng)!, /@/);
  assert.match(valueForField("CEP", rng)!, /^\d{5}-\d{3}$/);
  assert.equal(valueForField("quantidade", rng), undefined);
});
