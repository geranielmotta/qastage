import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type Papel = "admin" | "qa";

export interface Usuario {
  id: string;
  nome: string;
  /** Login (normalizado em minúsculas). */
  email: string;
  papel: Papel;
  /** Projetos atribuídos pelo admin (ids). Admin vê todos, independentemente desta lista. */
  projetos: string[];
  ativo: boolean;
  /** scrypt$<sal hex>$<hash hex> */
  senhaHash: string;
  criadoEm: string;
}

/** O que sai pela API: nunca o hash. */
export type UsuarioPublico = Omit<Usuario, "senhaHash">;
export const publico = ({ senhaHash: _, ...u }: Usuario): UsuarioPublico => u;

/** Pasta de dados do QAStage (usuários). Fora do git. */
export const dataDir = () => resolve(process.env.QASTAGE_DATA_DIR ?? "qastage-data");
const arquivo = () => join(dataDir(), "usuarios.json");

export const SENHA_MINIMA = 8;

export function hashSenha(senha: string): string {
  const sal = randomBytes(16);
  return `scrypt$${sal.toString("hex")}$${scryptSync(senha, sal, 64).toString("hex")}`;
}

export function confereSenha(senha: string, hash: string): boolean {
  const [alg, salHex, hashHex] = hash.split("$");
  if (alg !== "scrypt" || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, "hex");
  const obtido = scryptSync(senha, Buffer.from(salHex, "hex"), esperado.length);
  return timingSafeEqual(esperado, obtido);
}

/** Senha temporária legível (o admin repassa ao QA, que troca no primeiro acesso). */
export function senhaTemporaria(): string {
  return randomBytes(9).toString("base64url");
}

function validarSenha(senha: unknown): string {
  if (typeof senha !== "string" || senha.length < SENHA_MINIMA) throw new Error(`A senha precisa ter ao menos ${SENHA_MINIMA} caracteres.`);
  return senha;
}

function validarEmail(email: unknown): string {
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("E-mail inválido.");
  return e;
}

export function listarUsuarios(): Usuario[] {
  if (!existsSync(arquivo())) return [];
  return JSON.parse(readFileSync(arquivo(), "utf8")) as Usuario[];
}

/** Grava em arquivo temporário e renomeia: nunca deixa o arquivo pela metade. */
function salvar(us: Usuario[]): void {
  mkdirSync(dataDir(), { recursive: true });
  const tmp = arquivo() + ".tmp";
  writeFileSync(tmp, JSON.stringify(us, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, arquivo());
}

export const buscarPorEmail = (email: string) => listarUsuarios().find((u) => u.email === email.trim().toLowerCase());
export const buscarPorId = (id: string) => listarUsuarios().find((u) => u.id === id);

export interface NovoUsuario {
  nome: string;
  email: string;
  papel: Papel;
  senha: string;
  projetos?: string[];
}

export function criarUsuario(n: NovoUsuario): Usuario {
  const nome = typeof n.nome === "string" ? n.nome.trim() : "";
  if (!nome) throw new Error("Informe o nome.");
  const email = validarEmail(n.email);
  if (n.papel !== "admin" && n.papel !== "qa") throw new Error('Papel deve ser "admin" ou "qa".');
  const us = listarUsuarios();
  if (us.some((u) => u.email === email)) throw new Error(`Já existe usuário com o e-mail ${email}.`);
  const u: Usuario = {
    id: randomUUID(),
    nome,
    email,
    papel: n.papel,
    projetos: [...new Set(n.projetos ?? [])],
    ativo: true,
    senhaHash: hashSenha(validarSenha(n.senha)),
    criadoEm: new Date().toISOString(),
  };
  salvar([...us, u]);
  return u;
}

export interface AlteracaoUsuario {
  nome?: string;
  papel?: Papel;
  ativo?: boolean;
  projetos?: string[];
  senha?: string;
}

export function alterarUsuario(id: string, a: AlteracaoUsuario): Usuario {
  const us = listarUsuarios();
  const u = us.find((x) => x.id === id);
  if (!u) throw new Error("Usuário não encontrado.");
  if (a.nome !== undefined) {
    if (!a.nome.trim()) throw new Error("Informe o nome.");
    u.nome = a.nome.trim();
  }
  if (a.papel !== undefined) {
    if (a.papel !== "admin" && a.papel !== "qa") throw new Error('Papel deve ser "admin" ou "qa".');
    u.papel = a.papel;
  }
  if (a.ativo !== undefined) u.ativo = !!a.ativo;
  if (a.projetos !== undefined) {
    if (!Array.isArray(a.projetos) || a.projetos.some((p) => typeof p !== "string")) throw new Error("projetos deve ser uma lista de ids.");
    u.projetos = [...new Set(a.projetos)];
  }
  if (a.senha !== undefined) u.senhaHash = hashSenha(validarSenha(a.senha));
  // Nunca deixar o sistema sem um admin ativo (senão ninguém mais administra).
  if (!us.some((x) => x.papel === "admin" && x.ativo)) throw new Error("Precisa existir ao menos um administrador ativo.");
  salvar(us);
  return u;
}
