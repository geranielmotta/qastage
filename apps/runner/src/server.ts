import { createRegistry } from "./bootstrap";
import { conferirBanco } from "./db/conexao";
import { marcarInterrompidas } from "./db/execucoes";
import { limparSessoesExpiradas } from "./db/sessoes";
import { contarUsuarios } from "./db/usuarios";
import { loadDotEnv } from "./env";
import { workspaceRoot } from "./execute";
import { buildApp } from "./http/app";

/**
 * Sobe a API do runner (Fastify) — consumida pelo shell e pelos painéis.
 * Rotas em src/http/rotas/; regras de acesso em src/auth/; dados no Postgres (src/db/).
 */
async function main(): Promise<void> {
  // Caminhos relativos (artefatos, projetos) valem a partir da raiz do monorepo,
  // mesmo quando o servidor sobe de dentro de apps/runner (turbo dev).
  process.chdir(workspaceRoot());
  loadDotEnv();
  await conferirBanco();

  const interrompidas = await marcarInterrompidas();
  await limparSessoesExpiradas();

  const origens = new Set(
    (process.env.QASTAGE_ALLOWED_ORIGINS ?? [5173, 5174, 5175, 5176, 5177].map((p) => `http://localhost:${p}`).join(","))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const app = await buildApp(
    { registry: createRegistry(), raiz: process.cwd(), origens, cookieSeguro: process.env.QASTAGE_COOKIE_SECURE === "true" },
    { logger: true },
  );
  setInterval(() => void limparSessoesExpiradas().catch(() => undefined), 60 * 60 * 1000).unref();

  const port = Number(process.env.QASTAGE_PORT ?? 4000);
  await app.listen({ port, host: process.env.QASTAGE_HOST ?? "127.0.0.1" });
  if (interrompidas) app.log.warn(`${interrompidas} execução(ões) marcadas como interrompidas (o runner reiniciou durante elas).`);
  if ((await contarUsuarios()) === 0) app.log.info("Nenhum usuário ainda: abra o shell para criar o administrador (ou: pnpm run runner -- usuarios admin <email> <nome>).");
}

main().catch((e: Error) => {
  console.error(`[erro] ${e.message}`);
  process.exit(1);
});
