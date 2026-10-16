import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { br, Rng } from "@qastage/data";
import { generate, requiredFields } from "./body";
import { validateAgainst } from "./schema";
import { findEndpoint, loadSpec } from "./spec/load";

const DEMO = resolve(__dirname, "../../../../examples/api-demo/openapi.json");
const dir = mkdtempSync(join(tmpdir(), "qastage-api-"));
const arquivo = (nome: string, conteudo: unknown) => {
  const p = join(dir, nome);
  writeFileSync(p, typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo));
  return p;
};

test("OpenAPI 3 da demo: endpoints, $ref resolvido e corpo válido", async () => {
  const spec = await loadSpec(DEMO);
  assert.equal(spec.kind, "openapi3");
  const { endpoint } = findEndpoint(spec, "POST /clientes");
  assert.deepEqual(requiredFields(endpoint.body?.schema).sort(), ["cep", "cpf", "email", "nome"]);
  const corpo = generate(endpoint.body!.schema, new Rng(7)) as Record<string, string>;
  assert.ok(br.isValidCpf(corpo.cpf!), `cpf válido: ${corpo.cpf}`);
  assert.match(corpo.email!, /@/);
  assert.deepEqual(validateAgainst(endpoint.body!.schema!, corpo), []);
});

test("caminho concreto e operationId acham o endpoint", async () => {
  const spec = await loadSpec(DEMO);
  assert.deepEqual(findEndpoint(spec, "GET /clientes/42").pathParams, { id: "42" });
  assert.equal(findEndpoint(spec, "criarCliente").endpoint.id, "POST /clientes");
  assert.throws(() => findEndpoint(spec, "PUT /nada"), /não está em/);
});

test("Swagger 2.0 em YAML", async () => {
  const yaml = `swagger: "2.0"
info: { title: Legado, version: "1" }
paths:
  /pedidos:
    post:
      parameters:
        - in: body
          name: body
          required: true
          schema:
            type: object
            required: [cnpj, quantidade]
            properties:
              cnpj: { type: string }
              quantidade: { type: integer, minimum: 1, maximum: 10 }
      responses:
        "201": { description: ok, schema: { type: object, required: [id], properties: { id: { type: integer } } } }
`;
  const spec = await loadSpec(arquivo("legado.yaml", yaml));
  assert.equal(spec.kind, "swagger2");
  const e = findEndpoint(spec, "POST /pedidos").endpoint;
  const corpo = generate(e.body!.schema, new Rng(1)) as { cnpj: string; quantidade: number };
  assert.ok(br.isValidCnpj(corpo.cnpj));
  assert.ok(corpo.quantidade >= 1 && corpo.quantidade <= 10);
  assert.deepEqual(validateAgainst(e.responses["201"]!.schema!, { id: "x" }), ["id: esperado integer, veio string (\"x\")"]);
});

test("Postman collection: :id vira {id} e o exemplo vira schema", async () => {
  const col = {
    info: { name: "Antiga", _postman_id: "1", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    item: [
      { name: "Pasta", item: [{ name: "Buscar", request: { method: "GET", url: { raw: "{{baseUrl}}/clientes/:id", path: ["clientes", ":id"] } } }] },
      { name: "Criar", request: { method: "POST", url: "{{baseUrl}}/clientes", body: { mode: "raw", raw: '{"nome":"x","idade":3}' } } },
    ],
  };
  const spec = await loadSpec(arquivo("col.json", col));
  assert.equal(spec.kind, "postman");
  assert.deepEqual(spec.endpoints.map((e) => e.id).sort(), ["GET /clientes/{id}", "POST /clientes"]);
  assert.deepEqual(requiredFields(findEndpoint(spec, "POST /clientes").endpoint.body?.schema).sort(), ["idade", "nome"]);
});

test("nullable do OpenAPI aceita null", () => {
  assert.deepEqual(validateAgainst({ type: "object", properties: { x: { type: "string", nullable: true } } }, { x: null }), []);
});
