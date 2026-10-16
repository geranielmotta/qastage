import type { Rng } from "./random";

/** Dígito verificador no padrão módulo 11 da Receita (CPF/CNPJ). */
function dv(nums: number[], pesos: number[]): number {
  const soma = nums.reduce((acc, n, i) => acc + n * pesos[i]!, 0);
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

export function cpf(rng: Rng, formatted = false): string {
  let base = rng.digits(9);
  while (base.every((d) => d === base[0])) base = rng.digits(9); // 111.111.111-xx é inválido
  const d1 = dv(base, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv([...base, d1], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const s = [...base, d1, d2].join("");
  return formatted ? `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}` : s;
}

export function cnpj(rng: Rng, formatted = false): string {
  const base = [...rng.digits(8), 0, 0, 0, 1];
  const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const s = [...base, d1, d2].join("");
  return formatted ? `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}/${s.slice(8, 12)}-${s.slice(12)}` : s;
}

export function isValidCpf(v: string): boolean {
  const n = v.replace(/\D/g, "").split("").map(Number);
  if (n.length !== 11 || n.every((d) => d === n[0])) return false;
  return dv(n.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]) === n[9] && dv(n.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === n[10];
}

export function isValidCnpj(v: string): boolean {
  const n = v.replace(/\D/g, "").split("").map(Number);
  if (n.length !== 14 || n.every((d) => d === n[0])) return false;
  return (
    dv(n.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === n[12] &&
    dv(n.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === n[13]
  );
}

/** CEPs reais de capitais (o formato sozinho não garante CEP existente). */
const CEPS = ["01310-100", "20040-020", "30130-010", "40020-000", "70040-010", "80010-000", "90010-150", "60060-170", "50030-230", "69005-070"];

export function cep(rng: Rng, formatted = true): string {
  const c = rng.pick(CEPS);
  return formatted ? c : c.replace("-", "");
}

const DDDS = [11, 21, 31, 41, 51, 61, 71, 81, 85, 92];

export function celular(rng: Rng, formatted = false): string {
  const ddd = rng.pick(DDDS);
  const num = `9${rng.digits(8).join("")}`;
  return formatted ? `(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}` : `${ddd}${num}`;
}

const NOMES = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Felipe", "Gabriela", "Hugo", "Isabela", "João", "Larissa", "Marcos"];
const SOBRENOMES = ["Silva", "Souza", "Oliveira", "Santos", "Pereira", "Lima", "Carvalho", "Ferreira", "Almeida", "Ribeiro"];
const CIDADES = ["São Paulo", "Rio de Janeiro", "Belo Horizonte", "Salvador", "Brasília", "Curitiba", "Porto Alegre", "Recife"];
const UFS = ["SP", "RJ", "MG", "BA", "DF", "PR", "RS", "PE"];
const RUAS = ["Rua das Flores", "Avenida Paulista", "Rua XV de Novembro", "Avenida Brasil", "Rua da Consolação"];

export function nome(rng: Rng): string {
  return `${rng.pick(NOMES)} ${rng.pick(SOBRENOMES)}`;
}

export function email(rng: Rng, base?: string): string {
  const quem = (base ?? nome(rng))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, ".");
  return `${quem}.${rng.int(100, 999)}@teste.qastage.dev`;
}

export const cidade = (rng: Rng) => rng.pick(CIDADES);
export const uf = (rng: Rng) => rng.pick(UFS);
export const logradouro = (rng: Rng) => `${rng.pick(RUAS)}, ${rng.int(1, 2000)}`;

/** Data ISO (AAAA-MM-DD) de nascimento de um adulto entre 18 e 80 anos. */
export function dataNascimento(rng: Rng): string {
  const hoje = new Date();
  const ano = hoje.getFullYear() - rng.int(18, 80);
  return `${ano}-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`;
}
