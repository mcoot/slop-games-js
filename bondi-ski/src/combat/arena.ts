import type { RAPIER, PhysicsWorld } from "@slop/physics";
import { yawBasis, type MovementSettings, type PlayerController } from "@slop/fps-controller";
import { heightAt, inSea, surfaceAt, Surface, type CourseData } from "../course/data";
import type { Route } from "../course/route";
import type { Jetpack } from "../jetpack";
import { Bot, type Enemy } from "./bot";
import { blastOn, type Hit, type Target, type V3 } from "./damage";
import type { Fighter } from "./fighter";
import { Match } from "./match";
import { Projectiles, launchVelocity, type Impact } from "./projectiles";
import type { WeaponDef } from "./weapons";

/** Someone this machine is in charge of: the local player or a bot. */
export interface Local {
  id: string;
  body: PlayerController;
  fighter: Fighter;
  jet: Jetpack;
}

export interface ArenaEvents {
  shot(owner: string, weapon: WeaponDef, pos: V3, vel: V3): void;
  impact(impact: Impact): void;
  /** One of ours took damage. */
  hurt(victim: string, by: string, weapon: WeaponDef, hit: Hit, health: number): void;
  /** One of ours died. */
  died(victim: string, by: string, weapon: WeaponDef, hit: Hit): void;
  respawned(id: string): void;
}

/** How far from the middle of the course you can go before the arena pushes back (m). */
export const ARENA_RADIUS = 420;

/**
 * The fight, without any drawing: projectiles for everyone, damage and deaths for the
 * fighters this machine runs (you, and bots in solo practice), respawns and the score.
 * Remote players are targets for projectiles to burst on, but they judge their own damage.
 */
export class Arena {
  readonly projectiles: Projectiles;
  readonly bots: Bot[] = [];
  readonly match = new Match();
  readonly spawns: V3[];
  readonly centre: V3;
  /** Remote fighters as targets (drawn positions), set by the network layer each tick. */
  remoteTargets: Target[] = [];
  private seq = 0;
  private time = 0;

  constructor(
    private readonly world: PhysicsWorld,
    private readonly course: CourseData,
    route: Route,
    private readonly movement: MovementSettings,
    readonly me: Local,
    private readonly events: ArenaEvents,
    private readonly random: () => number = Math.random,
  ) {
    this.projectiles = new Projectiles(world, (c: RAPIER.Collider) => this.hulls().has(c.handle));
    this.spawns = spawnPoints(course, route);
    const mid = route.samples[Math.floor(route.samples.length / 2)]!;
    this.centre = { x: mid.x, y: mid.y, z: mid.z };
  }

  /** Everyone this machine runs. */
  locals(): Local[] {
    return [this.me, ...this.bots.map((b) => ({ id: b.id, body: b.body, fighter: b.fighter, jet: b.jet }))];
  }

  hulls(): Set<number> {
    return new Set(this.locals().map((l) => l.body.colliderHandle));
  }

  addBot(name: string, colour: string): Bot {
    const at = this.spawnPoint();
    const bot = new Bot(`bot-${this.bots.length + 1}`, name, colour, this.world, this.movement, at, undefined, this.bots.length + 1);
    this.bots.push(bot);
    return bot;
  }

  removeBots(): void {
    for (const b of this.bots) b.dispose();
    this.bots.length = 0;
  }

  /** Fire a weapon: spawns the projectile and reports it (so it can be sent to others). */
  fire(owner: string, w: WeaponDef, eye: V3, aim: V3, shooterVel: V3): void {
    // Leave from just in front of the eye so it clears your own hull.
    const pos = { x: eye.x + aim.x * 0.7, y: eye.y + aim.y * 0.7 - 0.12, z: eye.z + aim.z * 0.7 };
    const vel = launchVelocity(w, aim, shooterVel);
    this.projectiles.spawn({ id: `${owner}:${this.seq++}`, owner, weapon: w, pos, vel });
    this.events.shot(owner, w, pos, vel);
  }

  /** A shot someone else fired, `age` seconds ago. */
  remoteShot(owner: string, w: WeaponDef, pos: V3, vel: V3, age: number): void {
    this.projectiles.spawn({ id: `${owner}:${this.seq++}`, owner, weapon: w, pos, vel, age });
  }

  /** Bots decide and move (before the physics step), players' weapons are ticked by the caller. */
  stepBots(dt: number, enemiesOf: (bot: Bot) => Enemy[]): void {
    for (const bot of this.bots) {
      if (!bot.fighter.alive) continue;
      const { cmd, jet, fire, aim } = bot.think(dt, enemiesOf(bot), this.hulls());
      const { forward, right } = yawBasis(cmd.yaw);
      const wx = forward.x * cmd.forward + right.x * cmd.side;
      const wz = forward.z * cmd.forward + right.z * cmd.side;
      const wl = Math.hypot(wx, wz) || 1;
      bot.jet.tick(bot.body, jet, { x: wx / wl, y: 0, z: wz / wl }, dt);
      bot.body.tick(cmd, dt);
      if (bot.fighter.tickWeapons(fire, dt) > 0) this.fire(bot.id, bot.fighter.weapon.def, bot.eye(), aim, bot.body.velocity);
    }
  }

  /** Move projectiles; apply damage to our fighters; deaths, respawns, the arena edge. */
  step(dt: number): void {
    this.time += dt;
    const locals = this.locals();
    const targets: Target[] = [
      ...locals.filter((l) => l.fighter.alive).map((l) => targetOf(l)),
      ...this.remoteTargets,
    ];
    for (const impact of this.projectiles.step(dt, targets)) {
      this.events.impact(impact);
      const w = impact.projectile.weapon;
      if (impact.expired && w.splashRadius === 0) continue;
      for (const l of locals) {
        if (!l.fighter.alive) continue;
        const own = impact.projectile.owner === l.id;
        const hit = blastOn(w, impact.point, targetOf(l), impact.target?.id === l.id, own);
        if (!hit) continue;
        l.body.velocity.x += hit.impulse.x;
        l.body.velocity.y += hit.impulse.y;
        l.body.velocity.z += hit.impulse.z;
        if (hit.impulse.y > 2) l.body.grounded = false;
        this.damage(l, impact.projectile.owner, w, hit);
      }
    }
    for (const l of locals) {
      // Out past the arena edge: hurt until you come back.
      const d = Math.hypot(l.body.feet.x - this.centre.x, l.body.feet.z - this.centre.z);
      if (l.fighter.alive && d > ARENA_RADIUS) {
        this.damage(l, l.id, OUT_OF_BOUNDS, { damage: Math.ceil(150 * dt), impulse: { x: 0, y: 0, z: 0 }, direct: false, midair: false });
      }
      // The sea: straight to the bottom.
      if (l.fighter.alive && inSea(this.course.terrain, l.body.feet)) {
        this.damage(l, l.id, THE_SEA, { damage: l.fighter.health, impulse: { x: 0, y: 0, z: 0 }, direct: false, midair: false });
      }
      if (l.fighter.tick(dt)) this.respawn(l);
    }
  }

  /** Seconds of simulation so far. */
  now(): number {
    return this.time;
  }

  /** Apply damage to one of ours (the network layer calls this for nothing: remote players judge themselves). */
  damage(l: Local, by: string, w: WeaponDef, hit: Hit): void {
    const killed = l.fighter.hurt(hit.damage);
    this.events.hurt(l.id, by, w, hit, l.fighter.health);
    if (killed) {
      this.events.died(l.id, by, w, hit);
      this.match.recordDeath(l.id, by, this.time);
    }
  }

  respawn(l: Local): void {
    const at = this.spawnPoint();
    l.body.teleport(at);
    l.jet.reset();
    l.fighter.respawn();
    this.events.respawned(l.id);
  }

  /** A spawn point well away from everyone (best of a few random picks). */
  spawnPoint(): V3 {
    const others = [...this.locals().map((l) => l.body.feet), ...this.remoteTargets.map((t) => t.feet)];
    let best = this.spawns[0]!;
    let bestD = -1;
    for (let k = 0; k < 6; k++) {
      const s = this.spawns[Math.floor(this.random() * this.spawns.length)]!;
      const d = Math.min(Infinity, ...others.map((o) => Math.hypot(o.x - s.x, o.z - s.z)));
      if (d > bestD) {
        bestD = d;
        best = s;
      }
    }
    return { ...best };
  }

}

export const OUT_OF_BOUNDS: WeaponDef = {
  id: "edge",
  name: "the edge of the arena",
  speed: 0,
  inherit: 0,
  gravity: 0,
  lifetime: 0,
  radius: 0,
  damage: 0,
  splashRadius: 0,
  splashInner: 0,
  splashFalloff: 1,
  midairBonus: 1,
  selfDamage: 1,
  impulse: 0,
  selfImpulse: 1,
  burst: 1,
  burstInterval: 0,
  cooldown: 0,
  magazine: 0,
  reload: 0,
  spread: 0,
};

export const THE_SEA: WeaponDef = { ...OUT_OF_BOUNDS, name: "the Pacific" };

export function targetOf(l: Local): Target {
  const f = l.body.feet;
  return { id: l.id, feet: { x: f.x, y: f.y, z: f.z }, height: l.body.hullHeight(), radius: 0.45, airborne: !l.body.grounded };
}

/** Where to (re)spawn: on land along the course, a little either side of the walk. */
export function spawnPoints(course: CourseData, route: Route): V3[] {
  const out: V3[] = [];
  const t = course.terrain;
  for (let i = 5; i < route.samples.length - 5; i += 12) {
    const s = route.samples[i]!;
    for (const off of [0, -14, 14]) {
      const x = s.x + s.rx * off;
      const z = s.z + s.rz * off;
      const y = heightAt(t, x, z);
      if (y < 1.5 || surfaceAt(t, x, z) === Surface.sea) continue;
      out.push({ x, y: y + 0.4, z });
      break;
    }
  }
  return out;
}

/** Aim direction from yaw and pitch (controller conventions). */
export function aimOf(yaw: number, pitch: number): V3 {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

