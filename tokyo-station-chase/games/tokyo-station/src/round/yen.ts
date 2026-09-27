/** Japanese coins and notes, smallest first. */
export const DENOMINATIONS = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000] as const;
export type Denomination = (typeof DENOMINATIONS)[number];

export function isNote(d: Denomination): boolean {
  return d >= 1000;
}

export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString("en-US")}`;
}

/** Money as actual coins and notes, not just a total: you pay a machine one piece at a time. */
export class Wallet {
  private readonly counts = new Map<Denomination, number>();

  constructor(initial: Partial<Record<Denomination, number>> = {}) {
    for (const d of DENOMINATIONS) this.counts.set(d, initial[d] ?? 0);
  }

  count(d: Denomination): number {
    return this.counts.get(d)!;
  }

  get total(): number {
    let t = 0;
    for (const [d, n] of this.counts) t += d * n;
    return t;
  }

  add(d: Denomination, n = 1): void {
    this.counts.set(d, this.count(d) + n);
  }

  addAll(pieces: Denomination[]): void {
    for (const p of pieces) this.add(p);
  }

  /** Take one coin or note out. False if there isn't one. */
  take(d: Denomination): boolean {
    if (this.count(d) === 0) return false;
    this.counts.set(d, this.count(d) - 1);
    return true;
  }

  clear(): void {
    for (const d of DENOMINATIONS) this.counts.set(d, 0);
  }
}

/** Change for `amount` in as few pieces as possible (largest first), as a machine would give it. */
export function makeChange(amount: number): Denomination[] {
  const out: Denomination[] = [];
  let rest = amount;
  for (const d of [...DENOMINATIONS].reverse()) {
    while (rest >= d) {
      out.push(d);
      rest -= d;
    }
  }
  return out;
}
