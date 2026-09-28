/**
 * What racers send each other. Kept small and flat: positions go out ~20 times a second
 * to everyone in the room, everything else is occasional.
 */
export type NetMessage =
  /** Who I am. Sent on joining and whenever someone new appears. */
  | { t: "hello"; name: string; colour: string }
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
  | { t: "pong"; at: number };

/** Messages are plain JSON; drop anything that isn't one of ours. */
export function isNetMessage(v: unknown): v is NetMessage {
  if (!v || typeof v !== "object") return false;
  const t = (v as { t?: unknown }).t;
  return t === "hello" || t === "pos" || t === "countdown" || t === "gate" || t === "finish" || t === "ping" || t === "pong";
}
