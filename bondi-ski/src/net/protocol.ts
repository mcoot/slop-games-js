/**
 * What racers send each other. Kept small and flat: positions go out ~20 times a second
 * to everyone in the room, everything else is occasional.
 */
export type NetMessage =
  /** Who I am. Sent on joining and whenever someone new appears. */
  | { t: "hello"; name: string; colour: string; team?: number }
  /** Where I am. `race` is the race I'm in (or ""), `time` my race clock. */
  | { t: "pos"; seq: number; race: string; time: number; x: number; y: number; z: number; yaw: number; next: number }
  /** Start a race: everyone in the room counts down from `seconds` and goes together. */
  | { t: "countdown"; race: string; seconds: number }
  /** I passed a gate (`gate` index) at `time` on my race clock. */
  | { t: "gate"; race: string; gate: number; time: number }
  /** I finished. */
  | { t: "finish"; race: string; time: number }
  /** Round-trip timing, to start the countdown in step. */
  | { t: "ping"; at: number }
  | { t: "pong"; at: number }
  // ---- Deathmatch
  /** My fighter, ~20 times a second. `w` is the weapon in hand, `air` whether I'm off the ground. */
  | { t: "state"; seq: number; x: number; y: number; z: number; yaw: number; pitch: number; vx: number; vy: number; vz: number; alive: boolean; hp: number; w: string; air: boolean; team?: number }
  /** I fired: where from and how fast (spread and inherited velocity already applied). */
  | { t: "fire"; w: string; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  /** I was hurt (each player decides their own damage from the projectiles they see). */
  | { t: "hurt"; by: string; w: string; dmg: number; hp: number; midair: boolean }
  /** I died. */
  | { t: "died"; by: string; w: string }
  /** A new match: scores back to zero, first to `target` kills wins. */
  | { t: "match"; id: string; target: number };

/** Messages are plain JSON; drop anything that isn't one of ours. */
export function isNetMessage(v: unknown): v is NetMessage {
  if (!v || typeof v !== "object") return false;
  const t = (v as { t?: unknown }).t;
  return (
    t === "hello" ||
    t === "pos" ||
    t === "countdown" ||
    t === "gate" ||
    t === "finish" ||
    t === "ping" ||
    t === "pong" ||
    t === "state" ||
    t === "fire" ||
    t === "hurt" ||
    t === "died" ||
    t === "match"
  );
}
