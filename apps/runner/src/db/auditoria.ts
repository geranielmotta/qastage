import { db } from "./conexao";

/** Ações registradas: quem fez o quê (login, gestão de usuários, execuções, arquivos). */
export type Acao =
  | "login"
  | "login_falhou"
  | "logout"
  | "setup_admin"
  | "senha_trocada"
  | "usuario_criado"
  | "usuario_alterado"
  | "projeto_criado"
  | "arquivo_salvo"
  | "execucao_iniciada";

export interface QuemFez {
  id?: string;
  email?: string;
}

/** Auditoria nunca derruba a ação principal: falha vira aviso no log. */
export async function auditar(acao: Acao, quem: QuemFez | undefined, alvo?: string, detalhes?: Record<string, unknown>, ip?: string): Promise<void> {
  try {
    await db()("auditoria").insert({
      acao,
      usuario_id: quem?.id ?? null,
      usuario_email: quem?.email ?? null,
      alvo: alvo ?? null,
      detalhes: detalhes ? JSON.stringify(detalhes) : null,
      ip: ip ?? null,
    });
  } catch (e) {
    console.warn(`[auditoria] não registrada (${acao}): ${(e as Error).message}`);
  }
}
