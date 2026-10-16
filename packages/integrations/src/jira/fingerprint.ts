import { createHash } from "node:crypto";
import type { FailureReport } from "@qastage/core-contract";

/**
 * Normaliza a mensagem de erro para que a mesma falha gere sempre a mesma
 * chave: números, ids, horários e query strings variam entre execuções.
 */
export function normalizeError(error: string): string {
  return (error.split("\n")[0] ?? "")
    .toLowerCase()
    .replace(/https?:\/\/[^\s"']+/g, (u) => u.split(/[?#]/)[0]!)
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/g, "<uuid>")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dedupe: mesmo plugin + cenário + passo + erro normalizado → mesmo card. */
export function fingerprint(plugin: string, f: Pick<FailureReport, "scenario" | "step" | "error">): string {
  return createHash("sha1").update([plugin, f.scenario, f.step, normalizeError(f.error)].join("\u0000")).digest("hex").slice(0, 12);
}

/** Label que marca o card no Jira (labels não aceitam espaço). */
export const fingerprintLabel = (fp: string) => `qastage-${fp}`;
