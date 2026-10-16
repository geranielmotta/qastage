import * as br from "./br";
import type { Rng } from "./random";

/**
 * Preenchimento automático por nome de campo: o schema diz que existe um
 * campo `cpf`; o provedor resolve para um CPF válido. A ordem importa: o
 * primeiro padrão que casa vence ("email" antes de "nome").
 */
const PROVEDORES: Array<[RegExp, (rng: Rng) => string]> = [
  [/cpf/, (r) => br.cpf(r)],
  [/cnpj/, (r) => br.cnpj(r)],
  [/e-?mail/, (r) => br.email(r)],
  [/cep|zip|postal/, (r) => br.cep(r)],
  [/celular|telefone|phone|fone|whatsapp/, (r) => br.celular(r)],
  [/nascimento|birth/, (r) => br.dataNascimento(r)],
  [/cidade|city|municipio/, (r) => br.cidade(r)],
  [/^uf$|estado|state/, (r) => br.uf(r)],
  [/logradouro|endereco|address|rua|street/, (r) => br.logradouro(r)],
  [/senha|password/, (r) => `Qa!${r.int(100000, 999999)}x`],
  [/nome|name/, (r) => br.nome(r)],
];

const normaliza = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();

/** Valor válido para o campo pelo nome, ou undefined se nenhum provedor conhece o nome. */
export function valueForField(field: string, rng: Rng): string | undefined {
  const n = normaliza(field);
  for (const [re, gerar] of PROVEDORES) if (re.test(n)) return gerar(rng);
  return undefined;
}

/** Campos cujo valor nunca vai para relatório/pacote de falha (que podem virar anexo no Jira). */
const SENSIVEL = /senha|password|passwd|token|secret|segredo|pin\b|cvv|api.?key|authorization/i;

export function isSensitiveField(field: string): boolean {
  return SENSIVEL.test(field);
}
