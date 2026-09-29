import type { PhysicsWorld } from "@slop/physics";
import { inSea, type Terrain } from "../course/data";
import type { ArenaLayout } from "../maps";
import { extrapolate, type Moving } from "../net/predict";
import { exposedTo, OUT_OF_BOUNDS, spawnAwayFrom, THE_SEA } from "./arena";
import { blastOn, type Hit, type Target, type V3 } from "./damage";
import { Fighter } from "./fighter";
import { Match } from "./match";
import { Projectiles } from "./projectiles";
import type { GameType, TeamId } from "./teams";
import { WEAPONS, type ProjectileId, type WeaponDef } from "./weapons";

/** Someone in a refereed fight: what they last told us, and their health as we judge it. */
export interface Contender {
  id: string;
  team: TeamId | null;
  fighter: Fighter;
  /** Their last state and when it arrived (s, referee time); null until they send one. */
  last: (Moving & { at: number }) | null;
  /** One-way latency to them (s): how old their states are when they arrive, and their shots. */
  latency: number;
  /** Damage from the arena edge not yet reported (it's a steady trickle). */
  edgeOwed: number;
}

export interface RefereeEvents {
  /** Someone took damage: `hit.impulse` is their knockback. */
  hurt(victim: string, by: string, weapon: WeaponDef, hit: Hit, health: number): void;
  died(victim: string, by: string, weapon: WeaponDef, midair: boolean): void;
  /** Someone is back in, at `at`. */
  spawn(id: string, at: V3): void;
  /** A new match has started. */
  match(id: string, target: number): void;
}

export interface RefereeSettings {
  game: GameType;
  killTarget: number;
  teamKillTarget: number;
  /** Seconds of results before the next match. */
  resultsTime: number;
  /** Gravity (m/s²) and standing height (m), from the movement settings. */
  gravity: number;
  standHeight: number;
}

export const defaultRefereeSettings: Omit<RefereeSettings, "game"> = { killTarget: 15, teamKillTarget: 25, resultsTime: 10, gravity: 16, standHeight: 1.83 };

/** Most we'll fast-forward a late shot or guess ahead of a state (s). */
const MAX_AHEAD = 0.35;

/**
 * The fight as a game server judges it. Players move themselves and tell us where they
 * are and what they fired; the referee flies every projectile, decides who it hurt (against
 * where each player is *now*: their last state carried forward by its age), and owns
 * health, deaths, respawns and the score. The same combat rules as a solo game (`Arena`),
 * without anyone to drive.
 */
export class Referee {
  readonly contenders = new Map<string, Contender>();
  readonly projectiles: Projectiles;
  readonly match = new Match();
  private time = 0;
  private seq = 0;
  private readonly radius: number;

  constructor(
    private readonly world: PhysicsWorld,
    private readonly terrain: Terrain,
    private readonly layout: ArenaLayout,
    readonly settings: RefereeSettings,
    private readonly events: RefereeEvents,
    private readonly random: () => number = Math.random,
    private readonly newId: () => string = () => Math.random().toString(36).slice(2, 8),
  ) {
    this.projectiles = new Projectiles(world, () => false);
    // A walled arena's edge is the wall; only leaking past it (over the top) hurts.
    this.radius = layout.walled ? layout.radius + 3 : layout.radius;
    if (settings.game === "teams") this.match.teamOf = (id) => this.contenders.get(id)?.team ?? null;
    this.newMatch();
  }

  now(): number {
    return this.time;
  }

  get target(): number {
    return this.settings.game === "teams" ? this.settings.teamKillTarget : this.settings.killTarget;
  }

  join(id: string, team: TeamId | null = null): Contender {
    let c = this.contenders.get(id);
    if (!c) {
      c = { id, team, fighter: new Fighter(), last: null, latency: 0.05, edgeOwed: 0 };
      this.contenders.set(id, c);
    }
    return c;
  }

  leave(id: string): void {
    this.contenders.delete(id);
  }

  /** Where they are and how they're moving (arrived just now). */
  state(id: string, s: Moving): void {
    const c = this.contenders.get(id);
    if (!c) return;
    c.last = { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, air: s.air, at: this.time };
  }

  /** They fired (just arrived: it left their gun `latency` ago). */
  fire(id: string, weapon: string, pos: V3, vel: V3): void {
    const c = this.contenders.get(id);
    const w = WEAPONS[weapon as ProjectileId];
    if (!c || !w || !c.fighter.alive || this.match.over) return;
    // A shot from somewhere they can't be is ignored.
    const at = this.position(c);
    if (at && Math.hypot(pos.x - at.x, pos.y - at.y, pos.z - at.z) > 15) return;
    this.projectiles.spawn({ id: `${id}:${this.seq++}`, owner: id, weapon: w, pos: { ...pos }, vel: { ...vel }, age: Math.min(c.latency, MAX_AHEAD) });
  }

  /** Where they are now, as best we know: their last state carried forward by its age. */
  position(c: Contender): V3 | null {
    if (!c.last) return null;
    const ahead = Math.min(this.time - c.last.at + c.latency, MAX_AHEAD);
    return extrapolate(c.last, ahead, this.settings.gravity, null);
  }

  step(dt: number): void {
    this.time += dt;
    const targets: Target[] = [];
    for (const c of this.contenders.values()) {
      const p = c.fighter.alive ? this.position(c) : null;
      if (p) targets.push({ id: c.id, feet: p, height: this.settings.standHeight, radius: 0.45, airborne: c.last!.air });
    }
    for (const impact of this.projectiles.step(dt, targets)) {
      const w = impact.projectile.weapon;
      if (impact.expired && w.splashRadius === 0) continue;
      const owner = impact.projectile.owner;
      for (const t of targets) {
        const c = this.contenders.get(t.id);
        if (!c?.fighter.alive) continue;
        const own = owner === t.id;
        const direct = impact.target?.id === t.id;
        if (!direct && !exposedTo(this.world, impact.point, t, w.splashRadius, () => false)) continue;
        const hit = blastOn(w, impact.point, t, direct, own);
        if (!hit) continue;
        if (!own && this.sameTeam(owner, t.id)) {
          // Teammates' blasts still push.
          this.events.hurt(t.id, owner, w, { ...hit, damage: 0 }, c.fighter.health);
          continue;
        }
        this.damage(c, owner, w, hit);
      }
    }
    for (const c of this.contenders.values()) {
      const p = this.position(c);
      if (p && c.fighter.alive) {
        // Out past the arena edge: hurt until you come back.
        const d = Math.hypot(p.x - this.layout.centre.x, p.z - this.layout.centre.z);
        if (d > this.radius) {
          c.edgeOwed += 150 * dt;
          if (c.edgeOwed >= 30 || c.edgeOwed >= c.fighter.health) {
            const dmg = Math.ceil(c.edgeOwed);
            c.edgeOwed = 0;
            this.damage(c, c.id, OUT_OF_BOUNDS, { damage: dmg, impulse: { x: 0, y: 0, z: 0 }, direct: false, midair: false });
          }
        } else {
          c.edgeOwed = 0;
        }
        // The sea: straight to the bottom.
        if (c.fighter.alive && inSea(this.terrain, p)) {
          this.damage(c, c.id, THE_SEA, { damage: c.fighter.health, impulse: { x: 0, y: 0, z: 0 }, direct: false, midair: false });
        }
      }
      if (c.fighter.tick(dt)) this.respawn(c);
    }
    const m = this.match;
    if (m.over && this.time - m.endedAt > this.settings.resultsTime) this.newMatch();
  }

  private damage(c: Contender, by: string, w: WeaponDef, hit: Hit): void {
    const killed = c.fighter.hurt(hit.damage);
    this.events.hurt(c.id, by, w, hit, c.fighter.health);
    if (killed) {
      this.events.died(c.id, by, w, hit.midair);
      this.match.recordDeath(c.id, by, this.time);
    }
  }

  private sameTeam(a: string, b: string): boolean {
    if (this.settings.game !== "teams" || a === b) return false;
    const ta = this.contenders.get(a)?.team ?? null;
    return ta !== null && ta === (this.contenders.get(b)?.team ?? null);
  }

  respawn(c: Contender): void {
    const others: V3[] = [];
    for (const o of this.contenders.values()) {
      const p = o !== c && o.fighter.alive ? this.position(o) : null;
      if (p) others.push(p);
    }
    const at = spawnAwayFrom(this.layout.spawns, others, this.random);
    c.fighter.respawn();
    c.edgeOwed = 0;
    // Until their next state, they're where we put them.
    c.last = { ...at, vx: 0, vy: 0, vz: 0, air: false, at: this.time };
    this.events.spawn(c.id, at);
  }

  newMatch(): void {
    this.match.reset(this.newId(), this.target);
    this.projectiles.clear();
    this.events.match(this.match.id, this.target);
    for (const c of this.contenders.values()) this.respawn(c);
  }

  /** The scores so far, for someone joining mid-match. */
  board(): { board: [string, number, number][]; teamKills: [number, number] } {
    const ids = new Set([...this.match.kills.keys(), ...this.match.deaths.keys()]);
    return {
      board: [...ids].map((id) => [id, this.match.kills.get(id) ?? 0, this.match.deaths.get(id) ?? 0]),
      teamKills: [...this.match.teamKills],
    };
  }
}
