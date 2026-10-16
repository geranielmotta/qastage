import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Um elemento encontrado pelo scan numa tela. */
export interface ScannedElement {
  /** Valor do atributo de teste (data-testid), quando existe. */
  testid?: string;
  tag: string;
  role?: string;
  /** Rótulo humano inferido (label, aria-label, placeholder, texto). */
  label?: string;
  /** testid sugerido pela convenção (slug do rótulo) para quem não tem. */
  suggestedTestid?: string;
}

/** Mapa de uma tela, gravado pelo scan e lido na execução. */
export interface ScreenMap {
  screen: string;
  url: string;
  scannedAt: string;
  testIdAttribute: string;
  /** Elementos com testid: é por eles que os testes resolvem. */
  elements: ScannedElement[];
  /** Elementos interativos sem testid: pendência para o dev (ou fallback do QA). */
  missingTestid: ScannedElement[];
}

/**
 * Fallback manual do QA: quando o front não tem testid nem semântica, o QA diz
 * como achar o elemento. Uma das chaves basta.
 */
export interface ManualLocator {
  testid?: string;
  css?: string;
  text?: string;
  xpath?: string;
}

/** exceptions.json: { "<tela>" | "*": { "<rótulo>": ManualLocator } } */
export type ExceptionsFile = Record<string, Record<string, ManualLocator>>;

export const EXCEPTIONS_FILE = "exceptions.json";

export class MapStore {
  private readonly maps = new Map<string, ScreenMap | null>();
  private exceptions: ExceptionsFile | undefined;

  constructor(readonly dir: string) {}

  getMap(screen: string): ScreenMap | undefined {
    if (!this.maps.has(screen)) {
      const file = join(this.dir, `${screen}.json`);
      this.maps.set(screen, existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ScreenMap) : null);
    }
    return this.maps.get(screen) ?? undefined;
  }

  saveMap(map: ScreenMap): string {
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, `${map.screen}.json`);
    writeFileSync(file, JSON.stringify(map, null, 2) + "\n", "utf8");
    this.maps.set(map.screen, map);
    return file;
  }

  readExceptions(): ExceptionsFile {
    if (!this.exceptions) {
      const file = join(this.dir, EXCEPTIONS_FILE);
      this.exceptions = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as ExceptionsFile) : {};
    }
    return this.exceptions;
  }

  /** Grava (ou troca) a exceção manual de um rótulo numa tela. */
  setException(screen: string, rotulo: string, locator: ManualLocator): string {
    const todas = this.readExceptions();
    todas[screen] = { ...todas[screen], [rotulo]: locator };
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, EXCEPTIONS_FILE);
    writeFileSync(file, JSON.stringify(todas, null, 2) + "\n", "utf8");
    return file;
  }

  /** Exceção da tela tem prioridade sobre a global ("*"). */
  getException(screen: string, rotulo: string, normalize: (s: string) => string): ManualLocator | undefined {
    const todas = this.readExceptions();
    const alvo = normalize(rotulo);
    for (const escopo of [screen, "*"]) {
      for (const [chave, loc] of Object.entries(todas[escopo] ?? {})) {
        if (normalize(chave) === alvo) return loc;
      }
    }
    return undefined;
  }
}
