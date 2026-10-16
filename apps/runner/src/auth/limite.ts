/**
 * Limite de tentativas de login (em memória, por processo): 5 erros seguidos
 * bloqueiam aquele login por 1 minuto.
 */
const falhas = new Map<string, { n: number; ate: number }>();
const MAX_FALHAS = 5;
const BLOQUEIO_MS = 60 * 1000;

/** Segundos de bloqueio restantes para este login, ou 0. */
export function bloqueado(email: string): number {
  const f = falhas.get(email);
  if (!f || f.n < MAX_FALHAS) return 0;
  const resta = f.ate - Date.now();
  if (resta <= 0) {
    falhas.delete(email);
    return 0;
  }
  return Math.ceil(resta / 1000);
}

export function registrarFalha(email: string): void {
  const f = falhas.get(email) ?? { n: 0, ate: 0 };
  f.n += 1;
  if (f.n >= MAX_FALHAS) f.ate = Date.now() + BLOQUEIO_MS;
  falhas.set(email, f);
}

export const limparFalhas = (email: string) => falhas.delete(email);
