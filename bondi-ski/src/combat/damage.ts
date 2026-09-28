import type { WeaponDef } from "./weapons";

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** Someone who can be hit: a vertical capsule from the feet up. */
export interface Target {
  id: string;
  feet: V3;
  height: number;
  radius: number;
  /** Off the ground: direct hits count as midairs. */
  airborne: boolean;
}

export interface Hit {
  damage: number;
  /** Knockback to add to their velocity. */
  impulse: V3;
  direct: boolean;
  midair: boolean;
}

/** Closest point on the target's capsule axis to `p`. */
export function capsuleAxisPoint(t: Target, p: V3): V3 {
  const lo = t.feet.y + t.radius;
  const hi = t.feet.y + t.height - t.radius;
  return { x: t.feet.x, y: Math.min(Math.max(p.y, lo), hi), z: t.feet.z };
}

/**
 * Damage and knockback on `target` from a projectile that burst at `point`. `direct` is
 * whether it hit them. Your own blast hurts you less (disc jumping) but pushes as hard.
 */
export function blastOn(w: WeaponDef, point: V3, target: Target, direct: boolean, own: boolean): Hit | null {
  const axis = capsuleAxisPoint(target, point);
  const dx = axis.x - point.x;
  const dy = axis.y - point.y;
  const dz = axis.z - point.z;
  const dist = Math.max(Math.hypot(dx, dy, dz) - target.radius, 0);
  let damage = 0;
  let strength = 0;
  if (direct) {
    damage = w.damage;
    strength = 1;
  } else if (w.splashRadius > 0 && dist < w.splashRadius) {
    // Full damage in the core, then linear down to `splashFalloff` at the edge.
    const inner = Math.min(w.splashInner, w.splashRadius);
    const d = Math.max(dist - inner, 0) / (w.splashRadius - inner || 1);
    damage = w.damage * (1 - d * (1 - w.splashFalloff));
    strength = 1 - dist / w.splashRadius;
  } else {
    return null;
  }
  const midair = direct && target.airborne && !own;
  if (midair) damage *= w.midairBonus;
  if (own) damage *= w.selfDamage;
  // Push away from the blast, a little upwards so disc jumps lift.
  const len = Math.hypot(dx, dy, dz) || 1;
  const k = w.impulse * strength;
  const impulse = { x: (dx / len) * k, y: (dy / len) * k + k * 0.25, z: (dz / len) * k };
  return { damage: Math.round(damage), impulse, direct, midair };
}

/** Where along segment p0→p1 (fraction) it first comes within `r` of the target's capsule, or null. */
export function segmentHitsCapsule(p0: V3, p1: V3, t: Target, r: number): number | null {
  const reach = t.radius + r;
  const lo = t.feet.y + t.radius;
  const hi = t.feet.y + t.height - t.radius;
  // Sample the segment finely enough for fast projectiles against a ~0.8 m wide target.
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
  const steps = Math.max(1, Math.ceil(len / (reach * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const x = p0.x + (p1.x - p0.x) * f;
    const y = p0.y + (p1.y - p0.y) * f;
    const z = p0.z + (p1.z - p0.z) * f;
    const ay = Math.min(Math.max(y, lo), hi);
    if (Math.hypot(x - t.feet.x, y - ay, z - t.feet.z) <= reach) return f;
  }
  return null;
}
