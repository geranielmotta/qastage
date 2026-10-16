/**
 * Gerador pseudoaleatório com semente (mulberry32): a mesma semente gera os
 * mesmos dados — falha reproduzível. Sem semente, usa o relógio.
 */
export class Rng {
  private s: number;

  constructor(seed: number | string = Date.now()) {
    this.s = typeof seed === "number" ? seed >>> 0 : hash(seed);
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(list: readonly T[]): T {
    return list[this.int(0, list.length - 1)]!;
  }

  digits(n: number): number[] {
    return Array.from({ length: n }, () => this.int(0, 9));
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
