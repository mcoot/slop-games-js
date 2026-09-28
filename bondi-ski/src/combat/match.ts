/**
 * A deathmatch: kills and deaths per player, first to `target` kills wins. Everyone's
 * copy is fed the same death reports, so the boards agree.
 */
export class Match {
  id = "";
  winner: string | null = null;
  /** When the match ended (s, from `now`), for the results break. */
  endedAt = 0;
  readonly kills = new Map<string, number>();
  readonly deaths = new Map<string, number>();

  constructor(public target = 15) {}

  reset(id: string, target = this.target): void {
    this.id = id;
    this.target = target;
    this.winner = null;
    this.kills.clear();
    this.deaths.clear();
  }

  get over(): boolean {
    return this.winner !== null;
  }

  /** Someone died; `killer` is who fired the shot (themselves for a suicide). Returns the winner if this won it. */
  recordDeath(victim: string, killer: string, now: number): string | null {
    if (this.over) return null;
    this.deaths.set(victim, (this.deaths.get(victim) ?? 0) + 1);
    if (killer === victim) return null;
    const k = (this.kills.get(killer) ?? 0) + 1;
    this.kills.set(killer, k);
    if (k >= this.target) {
      this.winner = killer;
      this.endedAt = now;
      return killer;
    }
    return null;
  }

  /** Players by kills (then fewest deaths). */
  board(ids: string[]): { id: string; kills: number; deaths: number }[] {
    return ids
      .map((id) => ({ id, kills: this.kills.get(id) ?? 0, deaths: this.deaths.get(id) ?? 0 }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }
}
