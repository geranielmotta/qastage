import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Knex } from "knex";

/**
 * Configuração do Knex (CLI e runner). Conexão por DATABASE_URL ou, em dev,
 * pelo Postgres local com o usuário do sistema. O .env da raiz do monorepo
 * é carregado aqui também, para a CLI do knex enxergar a mesma configuração.
 */
function raiz(): string {
  for (let d = __dirname; ; d = dirname(d)) {
    if (existsSync(join(d, "pnpm-workspace.yaml"))) return d;
    if (dirname(d) === d) return __dirname;
  }
}
const envFile = join(raiz(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const comum: Knex.Config = {
  client: "pg",
  migrations: {
    directory: resolve(__dirname, "db/migrations"),
    tableName: "knex_migracoes",
    extension: "ts",
    loadExtensions: [".ts"],
  },
  seeds: {
    directory: resolve(__dirname, "db/seeds"),
    extension: "ts",
    loadExtensions: [".ts"],
  },
  pool: { min: 0, max: 10 },
};

const config: Record<string, Knex.Config> = {
  development: { ...comum, connection: process.env.DATABASE_URL ?? "postgres://localhost:5432/qastage" },
  test: { ...comum, connection: process.env.DATABASE_URL_TEST ?? "postgres://localhost:5432/qastage_test" },
  production: {
    ...comum,
    connection: process.env.DATABASE_URL ?? "",
    pool: { min: 2, max: 20 },
  },
};

export default config;
module.exports = config;
