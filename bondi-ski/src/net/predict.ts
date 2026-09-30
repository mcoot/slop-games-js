/** A fighter's last reported state: where, how fast, and whether they're off the ground. */
export interface Moving {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  air: boolean;
}

/**
 * Where someone will be `ahead` seconds after `s`: carried along by their velocity, and
 * falling if they're in the air (but not into the ground, if we know where it is).
 * Skiing is close to frictionless and flight is ballistic, so this is a good guess over a
 * fraction of a second; it's only wrong when they change what they're doing.
 */
export function extrapolate(s: Moving, ahead: number, gravity: number, ground: ((x: number, z: number) => number) | null): { x: number; y: number; z: number } {
  const g = s.air ? gravity : 0;
  const x = s.x + s.vx * ahead;
  const z = s.z + s.vz * ahead;
  let y = s.y + s.vy * ahead - 0.5 * g * ahead * ahead;
  if (s.air && ground) y = Math.max(y, Math.min(ground(x, z), s.y + s.vy * ahead));
  return { x, y, z };
}
