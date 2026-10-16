import knex, { type Knex } from "knex";
import config from "../../knexfile";

let instancia: Knex | undefined;

/** Conexão única do processo, pelo ambiente (NODE_ENV: development | test | production). */
export function db(): Knex {
  if (!instancia) {
    const env = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test" ? process.env.NODE_ENV : "development";
    instancia = knex(config[env]!);
  }
  return instancia;
}

export async function fecharDb(): Promise<void> {
  await instancia?.destroy();
  instancia = undefined;
}

/** Erro claro quando o banco não responde ou falta migration (em vez de stack do driver). */
export async function conferirBanco(): Promise<void> {
  try {
    await db().raw("select 1");
  } catch (e) {
    throw new Error(`Postgres indisponível (${(e as Error).message}). Confira DATABASE_URL no .env ou se o serviço está rodando.`);
  }
  const [, pendentes] = (await db().migrate.list()) as [unknown[], unknown[]];
  if (pendentes.length) throw new Error(`Há ${pendentes.length} migration(s) pendente(s). Rode: pnpm db:migrate`);
}
