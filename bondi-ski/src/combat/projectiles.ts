import { RAPIER, type PhysicsWorld } from "@slop/physics";
import { segmentHitsCapsule, type Target, type V3 } from "./damage";
import type { WeaponDef } from "./weapons";

export interface Projectile {
  id: string;
  owner: string;
  weapon: WeaponDef;
  pos: V3;
  prev: V3;
  vel: V3;
  age: number;
}

export interface Impact {
  projectile: Projectile;
  point: V3;
  /** The target it hit, if it hit someone rather than the ground (or ran out of time). */
  target: Target | null;
  /** It ran out of time in the air. */
  expired: boolean;
}

/**
 * Everyone's projectiles in flight. Each tick they move, and stop at the first thing in
 * their way: the world (a ray cast, ignoring players' own hulls) or a target's capsule.
 */
export class Projectiles {
  readonly list: Projectile[] = [];

  constructor(
    private readonly world: PhysicsWorld,
    /** Colliders projectiles pass through (players' movement hulls). */
    private readonly ignore: (collider: RAPIER.Collider) => boolean,
  ) {}

  spawn(p: Omit<Projectile, "age" | "prev"> & { age?: number }): Projectile {
    const proj: Projectile = { ...p, prev: { ...p.pos }, age: 0 };
    this.list.push(proj);
    // Catch up if it was fired a while ago (a remote shot arriving late).
    if (p.age && p.age > 0) this.advance(proj, Math.min(p.age, 0.25));
    return proj;
  }

  clear(): void {
    this.list.length = 0;
  }

  /** Move everything by `dt`; returns what hit something (those are removed). */
  step(dt: number, targets: Target[]): Impact[] {
    const impacts: Impact[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]!;
      const from = { ...p.pos };
      this.advance(p, dt);
      const hit = this.trace(p, from, p.pos, targets);
      if (hit) {
        impacts.push(hit);
        this.list.splice(i, 1);
      } else if (p.age >= p.weapon.lifetime) {
        impacts.push({ projectile: p, point: { ...p.pos }, target: null, expired: true });
        this.list.splice(i, 1);
      }
    }
    return impacts;
  }

  private advance(p: Projectile, dt: number): void {
    p.prev = { ...p.pos };
    p.vel.y -= p.weapon.gravity * dt;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.pos.z += p.vel.z * dt;
    p.age += dt;
  }

  private trace(p: Projectile, from: V3, to: V3, targets: Target[]): Impact | null {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return null;
    let bestF = Infinity;
    let best: Target | null = null;
    for (const t of targets) {
      if (t.id === p.owner && p.age < 0.25) continue; // don't hit yourself leaving the muzzle
      const f = segmentHitsCapsule(from, to, t, p.weapon.radius);
      if (f !== null && f < bestF) {
        bestF = f;
        best = t;
      }
    }
    const ray = new RAPIER.Ray(from, { x: dx / len, y: dy / len, z: dz / len });
    const hit = this.world.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, (c) => !this.ignore(c));
    if (hit && hit.timeOfImpact / len < bestF) {
      const f = hit.timeOfImpact / len;
      return { projectile: p, point: { x: from.x + dx * f, y: from.y + dy * f, z: from.z + dz * f }, target: null, expired: false };
    }
    if (best) {
      return { projectile: p, point: { x: from.x + dx * bestF, y: from.y + dy * bestF, z: from.z + dz * bestF }, target: best, expired: false };
    }
    return null;
  }
}

/** A projectile's starting velocity: aim direction (with spread) times muzzle speed, plus inherited shooter velocity. */
export function launchVelocity(w: WeaponDef, aim: V3, shooterVel: V3, random: () => number = Math.random): V3 {
  let { x, y, z } = aim;
  if (w.spread > 0) {
    x += (random() - 0.5) * 2 * w.spread;
    y += (random() - 0.5) * 2 * w.spread;
    z += (random() - 0.5) * 2 * w.spread;
    const l = Math.hypot(x, y, z);
    x /= l;
    y /= l;
    z /= l;
  }
  return {
    x: x * w.speed + shooterVel.x * w.inherit,
    y: y * w.speed + shooterVel.y * w.inherit,
    z: z * w.speed + shooterVel.z * w.inherit,
  };
}
