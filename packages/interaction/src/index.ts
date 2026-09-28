/**
 * Look-at-and-press interaction: find the thing the player is looking at within
 * reach, so the game can show a prompt and call it on the use key.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Interactable {
  id: string;
  position: Vec3;
  /** Prompt text, e.g. "Buy a ticket". */
  prompt: string;
  /** Reach override (m). */
  range?: number;
  /** Return false to temporarily disable (not focusable). */
  enabled?: () => boolean;
}

export interface InteractionSettings {
  /** Default reach from the eye (m). */
  range: number;
  /** How far off the view direction something can be and still be focused (degrees). */
  maxAngleDeg: number;
}

export const defaultInteraction: InteractionSettings = { range: 2.2, maxAngleDeg: 25 };

/**
 * The interactable closest to the centre of view within reach, or null. `blocked`
 * (e.g. a physics ray) can rule out things behind walls.
 */
export function findFocus<T extends Interactable>(
  eye: Vec3,
  forward: Vec3,
  items: Iterable<T>,
  settings: InteractionSettings = defaultInteraction,
  blocked?: (from: Vec3, to: Vec3) => boolean,
): T | null {
  const flen = Math.hypot(forward.x, forward.y, forward.z) || 1;
  const cosMax = Math.cos((settings.maxAngleDeg * Math.PI) / 180);
  let best: T | null = null;
  let bestCos = -Infinity;
  for (const item of items) {
    if (item.enabled && !item.enabled()) continue;
    const dx = item.position.x - eye.x;
    const dy = item.position.y - eye.y;
    const dz = item.position.z - eye.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > (item.range ?? settings.range)) continue;
    const cos = d < 1e-6 ? 1 : (dx * forward.x + dy * forward.y + dz * forward.z) / (d * flen);
    if (cos < cosMax || cos <= bestCos) continue;
    if (blocked?.(eye, item.position)) continue;
    best = item;
    bestCos = cos;
  }
  return best;
}
