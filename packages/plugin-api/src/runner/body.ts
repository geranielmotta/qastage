import { Rng, valueForField } from "@qastage/data";
import type { JsonSchema } from "./spec/model";

/**
 * Gera um corpo estruturalmente válido a partir do schema: a estrutura vem do
 * schema (required, enum, formatos, limites); o VALOR vem do módulo de dados
 * pelo nome do campo (cpf → CPF válido). Opcionais só entram se soubermos
 * gerar um valor bom para eles.
 */
export function generate(schema: JsonSchema | undefined, rng: Rng, field = "", depth = 0): unknown {
  if (!schema || depth > 6) return null;
  if (schema.example !== undefined && depth > 0) return structuredClone(schema.example);
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s: JsonSchema) => generate(s, rng, field, depth)));
  if (schema.oneOf || schema.anyOf) return generate((schema.oneOf ?? schema.anyOf)[0], rng, field, depth);
  if (schema.enum) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;

  const tipo = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== "null") : schema.type ?? (schema.properties ? "object" : "string");
  switch (tipo) {
    case "object": {
      const out: Record<string, unknown> = {};
      const required = new Set<string>(schema.required ?? []);
      for (const [nome, p] of Object.entries((schema.properties ?? {}) as Record<string, JsonSchema>)) {
        if (p.readOnly) continue; // o servidor que preenche (id, criadoEm...)
        const conhecido = p.enum !== undefined || valueForField(nome, new Rng(0)) !== undefined;
        if (required.has(nome) || conhecido) out[nome] = generate(p, rng, nome, depth + 1);
      }
      return out;
    }
    case "array": {
      const n = Math.max(1, schema.minItems ?? 1);
      return Array.from({ length: n }, () => generate(schema.items, rng, field, depth + 1));
    }
    case "integer":
    case "number": {
      const min = schema.minimum ?? (schema.exclusiveMinimum !== undefined ? Number(schema.exclusiveMinimum) + 1 : 1);
      const max = schema.maximum ?? Math.max(min + 100, min);
      const n = rng.int(Math.ceil(min), Math.floor(max));
      return tipo === "integer" ? n : n + 0.5 <= max ? n + 0.5 : n;
    }
    case "boolean":
      return true;
    default:
      return stringFor(schema, field, rng);
  }
}

function stringFor(schema: JsonSchema, field: string, rng: Rng): string {
  switch (schema.format) {
    case "email":
      return valueForField("email", rng)!;
    case "date":
      return new Date().toISOString().slice(0, 10);
    case "date-time":
      return new Date().toISOString();
    case "uuid":
      return crypto.randomUUID();
    case "uri":
    case "url":
      return "https://exemplo.qastage.dev/recurso";
  }
  let v = valueForField(field, rng) ?? `teste ${field || "valor"} ${rng.int(100, 999)}`.trim();
  if (schema.pattern && !new RegExp(schema.pattern).test(v)) {
    // Valor do provedor não bate com o pattern: tenta só os dígitos (CPF/CEP formatados).
    const digitos = v.replace(/\D/g, "");
    if (new RegExp(schema.pattern).test(digitos)) v = digitos;
  }
  if (schema.maxLength && v.length > schema.maxLength) v = v.slice(0, schema.maxLength);
  if (schema.minLength && v.length < schema.minLength) v = v.padEnd(schema.minLength, "x");
  return v;
}

// ── Caminhos ("endereco.cep", "itens.0.qtd") ────────────────────────────────

export function setPath(obj: unknown, path: string, value: unknown): void {
  const partes = path.split(".");
  let cur = obj as Record<string, unknown>;
  for (const p of partes.slice(0, -1)) {
    if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[partes.at(-1)!] = value;
}

export function deletePath(obj: unknown, path: string): boolean {
  const partes = path.split(".");
  let cur = obj as Record<string, unknown> | undefined;
  for (const p of partes.slice(0, -1)) cur = cur?.[p] as Record<string, unknown> | undefined;
  if (!cur || !(partes.at(-1)! in cur)) return false;
  delete cur[partes.at(-1)!];
  return true;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, p) => (acc == null ? undefined : (acc as Record<string, unknown>)[p]), obj);
}

/** Valor de tipo errado para um campo (negativo de tipo). */
export function wrongTypeFor(schema: JsonSchema | undefined, atual: unknown): unknown {
  const tipo = schema?.type ?? typeof atual;
  if (tipo === "string") return 12345;
  if (tipo === "integer" || tipo === "number") return "não é número";
  if (tipo === "boolean") return "talvez";
  if (tipo === "array") return { naoE: "lista" };
  return "não é objeto";
}

/** Converte o valor escrito no .feature para o tipo do schema ("10" → 10 se o campo é number). */
export function coerce(raw: string, schema: JsonSchema | undefined): unknown {
  const tipo = Array.isArray(schema?.type) ? schema!.type[0] : schema?.type;
  if (raw === "null") return null;
  if ((tipo === "integer" || tipo === "number") && raw.trim() !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  if (tipo === "boolean" && (raw === "true" || raw === "false")) return raw === "true";
  if ((tipo === "object" || tipo === "array") && /^[[{]/.test(raw.trim())) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

/** Junta allOf num objeto só (properties + required), recursivo. */
export function flat(schema: JsonSchema | undefined): JsonSchema | undefined {
  if (!schema?.allOf) return schema;
  const partes = schema.allOf.map((x: JsonSchema) => flat(x) ?? {});
  return {
    ...schema,
    allOf: undefined,
    type: schema.type ?? partes.find((x: JsonSchema) => x.type)?.type ?? "object",
    properties: Object.assign({}, ...partes.map((x: JsonSchema) => x.properties ?? {}), schema.properties ?? {}),
    required: [...new Set([...partes.flatMap((x: JsonSchema) => x.required ?? []), ...(schema.required ?? [])])],
  };
}

/** Schema da propriedade num caminho ("endereco.cep"). */
export function schemaAt(schema: JsonSchema | undefined, path: string): JsonSchema | undefined {
  let cur = flat(schema);
  for (const p of path.split(".")) {
    if (!cur) return undefined;
    cur = flat(cur.type === "array" ? cur.items : cur.properties?.[p]);
  }
  return cur;
}

/** Campos do primeiro nível (sem os readOnly), com o schema de cada um. */
export function topLevelFields(schema: JsonSchema | undefined): Array<[string, JsonSchema]> {
  return Object.entries((flat(schema)?.properties ?? {}) as Record<string, JsonSchema>).filter(([, x]) => !x.readOnly);
}

/** Campos obrigatórios do primeiro nível (sem os readOnly). */
export function requiredFields(schema: JsonSchema | undefined): string[] {
  const f = flat(schema);
  return ((f?.required ?? []) as string[]).filter((n) => !f?.properties?.[n]?.readOnly);
}
