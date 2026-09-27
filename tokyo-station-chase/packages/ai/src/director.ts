import type { Navigation, Vec3 } from "./navigation";
import { dist } from "./navigation";

export interface DirectorContext {
  nav: Navigation;
  /** Where the quarry really is. A director may use it, but should only hand out fuzzy information. */
  quarry: Vec3;
  hunter: Vec3;
  /** Seconds since the hunter last saw or heard the quarry. */
  timeLost: number;
  random: () => number;
}

export interface Directive {
  /** Where to go and search. */
  position: Vec3;
  kind: "hint" | "chokepoint";
}

/**
 * Keeps a searcher from going cold once it has lost track of its quarry. The
 * searcher asks for a new place to look whenever it's ready for one.
 */
export interface Director {
  /** Seconds a searcher waits before asking for the next directive. */
  readonly interval: number;
  next(ctx: DirectorContext): Directive | null;
  /** Called when the hunter senses the quarry again. */
  reset(): void;
}

export interface HintDirectorSettings {
  /** Seconds between directives. */
  interval: number;
  /** Hint radius right after losing the quarry (m). */
  radiusStart: number;
  /** It never gets tighter than this (m). */
  radiusMin: number;
  /** How fast the radius shrinks (m per second lost). */
  shrinkRate: number;
}

export const defaultHintDirector: HintDirectorSettings = {
  interval: 6,
  radiusStart: 40,
  radiusMin: 15,
  shrinkRate: 0.6,
};

/**
 * Alternates two kinds of directive: a fuzzy hint (a random reachable point within a
 * radius of the quarry that shrinks the longer it's lost) and an ambush at the
 * chokepoint nearest the quarry, i.e. somewhere it will probably have to pass.
 */
export class HintDirector implements Director {
  chokepoints: Vec3[] = [];
  private count = 0;

  constructor(public settings: HintDirectorSettings = { ...defaultHintDirector }) {}

  get interval(): number {
    return this.settings.interval;
  }

  radius(timeLost: number): number {
    const s = this.settings;
    return Math.max(s.radiusMin, s.radiusStart - s.shrinkRate * timeLost);
  }

  next(ctx: DirectorContext): Directive | null {
    const useChokepoint = this.chokepoints.length > 0 && this.count % 2 === 1;
    this.count++;
    if (useChokepoint) {
      const choke = this.chokepointFor(ctx);
      if (choke) return { position: choke, kind: "chokepoint" };
    }
    const hint = ctx.nav.randomPointNear(ctx.quarry, this.radius(ctx.timeLost), ctx.random);
    return hint ? { position: hint, kind: "hint" } : null;
  }

  reset(): void {
    this.count = 0;
  }

  /** The reachable chokepoint closest to the quarry, skipping one the hunter is already at. */
  private chokepointFor(ctx: DirectorContext): Vec3 | null {
    const candidates = this.chokepoints
      .map((p) => ctx.nav.closestPoint(p))
      .filter((p): p is Vec3 => p !== null && dist(p, ctx.hunter) > 3)
      .sort((a, b) => dist(a, ctx.quarry) - dist(b, ctx.quarry));
    return candidates[0] ?? null;
  }
}
