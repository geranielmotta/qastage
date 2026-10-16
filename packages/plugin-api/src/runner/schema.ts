import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import type { JsonSchema } from "./spec/model";

/**
 * OpenAPI usa um dialeto de JSON Schema: `nullable`, `example`, `readOnly`,
 * `discriminator`... Convertemos para JSON Schema puro antes do ajv.
 * `direction` decide se readOnly/writeOnly somem do "required".
 */
export function toJsonSchema(s: JsonSchema | undefined, direction: "request" | "response", seen = new WeakMap<object, JsonSchema>()): JsonSchema {
  if (!s || typeof s !== "object") return {};
  if (seen.has(s)) return seen.get(s)!; // schema circular (árvore, lista ligada...)
  const out: JsonSchema = {};
  seen.set(s, out);

  for (const [k, v] of Object.entries(s)) {
    if (["nullable", "example", "examples", "discriminator", "xml", "externalDocs", "deprecated", "readOnly", "writeOnly", "x-nullable"].includes(k) || k.startsWith("x-")) continue;
    if (k === "properties") {
      out.properties = Object.fromEntries(Object.entries(v as Record<string, JsonSchema>).map(([n, p]) => [n, toJsonSchema(p, direction, seen)]));
    } else if (["items", "not", "additionalProperties"].includes(k) && v && typeof v === "object") {
      out[k] = toJsonSchema(v as JsonSchema, direction, seen);
    } else if (["allOf", "anyOf", "oneOf"].includes(k)) {
      out[k] = (v as JsonSchema[]).map((x) => toJsonSchema(x, direction, seen));
    } else {
      out[k] = v;
    }
  }

  if ((s.nullable || s["x-nullable"]) && out.type) out.type = Array.isArray(out.type) ? [...out.type, "null"] : [out.type, "null"];
  if (Array.isArray(out.required) && s.properties) {
    const ignorar = direction === "response" ? "writeOnly" : "readOnly";
    out.required = out.required.filter((n: string) => !(s.properties[n] as JsonSchema | undefined)?.[ignorar]);
  }
  return out;
}

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true, verbose: true });
addFormats(ajv);
const compilados = new WeakMap<object, ReturnType<typeof ajv.compile>>();

/** Valida o valor contra o schema da resposta; devolve os erros legíveis (vazio = ok). */
export function validateAgainst(schema: JsonSchema, value: unknown): string[] {
  let validar = compilados.get(schema);
  if (!validar) {
    validar = ajv.compile(toJsonSchema(schema, "response"));
    compilados.set(schema, validar);
  }
  if (validar(value)) return [];
  return (validar.errors ?? []).map(legivel);
}

function legivel(e: ErrorObject): string {
  const onde = e.instancePath ? e.instancePath.slice(1).replace(/\//g, ".") : "(raiz)";
  switch (e.keyword) {
    case "type":
      return `${onde}: esperado ${e.params.type}, veio ${tipo(e.data)} (${JSON.stringify(e.data)})`;
    case "required":
      return `${onde === "(raiz)" ? "" : onde + "."}${e.params.missingProperty}: campo obrigatório ausente`;
    case "enum":
      return `${onde}: valor fora do enum ${JSON.stringify(e.params.allowedValues)}`;
    case "format":
      return `${onde}: formato "${e.params.format}" inválido (${JSON.stringify(e.data)})`;
    default:
      return `${onde}: ${e.message}`;
  }
}

const tipo = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
