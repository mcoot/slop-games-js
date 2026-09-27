/**
 * The Quake/Source movement maths, as pure functions on plain vectors so they
 * can be unit tested without a physics world. Names follow gamemovement.cpp.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function horizontalSpeed(v: Vec3): number {
  return Math.hypot(v.x, v.z);
}

/** Ground friction. Operates on horizontal velocity only (vertical is zero on the ground). */
export function applyFriction(v: Vec3, friction: number, stopSpeed: number, dt: number): void {
  const speed = horizontalSpeed(v);
  if (speed < 0.001) {
    v.x = 0;
    v.z = 0;
    return;
  }
  const control = speed < stopSpeed ? stopSpeed : speed;
  const drop = control * friction * dt;
  const scale = Math.max(speed - drop, 0) / speed;
  v.x *= scale;
  v.z *= scale;
}

/** Ground acceleration towards `wishDir` (unit, horizontal) up to `wishSpeed`. */
export function accelerate(v: Vec3, wishDir: Vec3, wishSpeed: number, accel: number, dt: number): void {
  const current = v.x * wishDir.x + v.z * wishDir.z;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const accelSpeed = Math.min(accel * dt * wishSpeed, add);
  v.x += accelSpeed * wishDir.x;
  v.z += accelSpeed * wishDir.z;
}

/**
 * Air acceleration. The projection onto wishDir is capped at `airCap`, but the
 * acceleration itself uses the full wish speed: turning while strafing keeps
 * the projection small, so speed keeps being added. That is air strafing.
 */
export function airAccelerate(
  v: Vec3,
  wishDir: Vec3,
  wishSpeed: number,
  airAccel: number,
  airCap: number,
  dt: number,
): void {
  const capped = Math.min(wishSpeed, airCap);
  const current = v.x * wishDir.x + v.z * wishDir.z;
  const add = capped - current;
  if (add <= 0) return;
  const accelSpeed = Math.min(airAccel * wishSpeed * dt, add);
  v.x += accelSpeed * wishDir.x;
  v.z += accelSpeed * wishDir.z;
}

/** Remove the component of `v` going into the plane with normal `n`. */
export function clipVelocity(v: Vec3, n: Vec3, overbounce = 1): void {
  const backoff = (v.x * n.x + v.y * n.y + v.z * n.z) * overbounce;
  v.x -= n.x * backoff;
  v.y -= n.y * backoff;
  v.z -= n.z * backoff;
  // Avoid creeping back into the plane from float error.
  const adjust = v.x * n.x + v.y * n.y + v.z * n.z;
  if (adjust < 0) {
    v.x -= n.x * adjust;
    v.y -= n.y * adjust;
    v.z -= n.z * adjust;
  }
}

/**
 * Clip against every plane we hit this move. If two planes still disagree
 * (a corner or crease) slide along their intersection, like Source's TryPlayerMove.
 */
export function clipVelocityToPlanes(v: Vec3, planes: Vec3[]): void {
  for (const n of planes) {
    if (v.x * n.x + v.y * n.y + v.z * n.z < 0) clipVelocity(v, n);
  }
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      const a = planes[i]!;
      const b = planes[j]!;
      const intoA = v.x * a.x + v.y * a.y + v.z * a.z < -1e-6;
      const intoB = v.x * b.x + v.y * b.y + v.z * b.z < -1e-6;
      if (!intoA && !intoB) continue;
      const cx = a.y * b.z - a.z * b.y;
      const cy = a.z * b.x - a.x * b.z;
      const cz = a.x * b.y - a.y * b.x;
      const len = Math.hypot(cx, cy, cz);
      if (len < 1e-6) continue;
      const d = (v.x * cx + v.y * cy + v.z * cz) / (len * len);
      v.x = cx * d;
      v.y = cy * d;
      v.z = cz * d;
    }
  }
}

/** Unit forward and right vectors on the ground plane for a yaw (0 = looking down -Z, positive turns left). */
export function yawBasis(yaw: number): { forward: Vec3; right: Vec3 } {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return {
    forward: { x: -s, y: 0, z: -c },
    right: { x: c, y: 0, z: -s },
  };
}
