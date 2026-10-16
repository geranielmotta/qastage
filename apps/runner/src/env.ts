import { existsSync } from "node:fs";
import { join } from "node:path";
import { workspaceRoot } from "./execute";

/** Carrega o .env da raiz do monorepo (segredos de integrações), se existir. Variáveis já definidas vencem. */
export function loadDotEnv(): void {
  const file = join(workspaceRoot(), ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}
