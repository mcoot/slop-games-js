import type { Gate } from "../course/route";
import type { Vec3 } from "../course/data";

/**
 * One racer's run through the gates. Gates are vertical planes across the course;
 * passing one means crossing its plane going forwards, within `halfWidth` of its
 * centre, in order. The clock starts when you cross the start gate (leave the pad)
 * and stops at the last. Pure state, driven by positions each tick, so the same code
 * can track remote racers from their snapshots later.
 */
export interface RaceSettings {
  /** How far either side of the course a gate counts (m): wide, so you can take your own line. */
  halfWidth: number;
}

export const defaultRaceSettings: RaceSettings = { halfWidth: 45 };

export type RaceState = "ready" | "running" | "finished";

export interface RaceEvent {
  kind: "start" | "split" | "finish";
  gate: number;
  /** Seconds since the start. */
  time: number;
}

export class RaceTracker {
  state: RaceState = "ready";
  /** Seconds since the start gate. */
  time = 0;
  /** Index of the next gate to pass. */
  next = 0;
  /** Time at each gate passed, in order (index 0 is the start, at 0). */
  splits: number[] = [];
  readonly events: RaceEvent[] = [];

  constructor(
    public gates: Gate[],
    readonly settings: RaceSettings = { ...defaultRaceSettings },
  ) {}

  reset(): void {
    this.state = "ready";
    this.time = 0;
    this.next = 0;
    this.splits = [];
    this.events.length = 0;
  }

  /** Mass start: the clock starts now, as if the start gate had just been crossed. */
  startNow(): void {
    this.reset();
    this.state = "running";
    this.splits = [0];
    this.next = 1;
  }

  /** The last gate passed (for respawning), or 0 before the start. */
  get lastGate(): number {
    return Math.max(this.next - 1, 0);
  }

  /** Advance by one tick in which the racer moved from `from` to `to`. Returns this tick's events. */
  tick(dt: number, from: Vec3, to: Vec3): RaceEvent[] {
    this.events.length = 0;
    if (this.state === "running") this.time += dt;
    if (this.state === "finished") return this.events;
    const gate = this.gates[this.next];
    if (!gate) return this.events;
    const hit = crossing(gate, from, to, this.settings.halfWidth);
    if (hit === null) return this.events;
    if (this.state === "ready") {
      // Start the clock at the exact moment of crossing.
      this.state = "running";
      this.time = dt * (1 - hit);
      this.splits = [0];
      this.events.push({ kind: "start", gate: 0, time: 0 });
    } else {
      const t = this.time - dt * (1 - hit);
      this.splits.push(t);
      const last = this.next === this.gates.length - 1;
      this.events.push({ kind: last ? "finish" : "split", gate: this.next, time: t });
      if (last) {
        this.state = "finished";
        this.time = t;
      }
    }
    this.next++;
    return this.events;
  }
}

/** Fraction (0..1) along from→to where it crosses the gate's plane forwards, or null. */
export function crossing(gate: Gate, from: Vec3, to: Vec3, halfWidth: number): number | null {
  const p = gate.sample;
  const d0 = (from.x - p.x) * p.tx + (from.z - p.z) * p.tz;
  const d1 = (to.x - p.x) * p.tx + (to.z - p.z) * p.tz;
  if (!(d0 < 0 && d1 >= 0)) return null;
  const f = d0 / (d0 - d1);
  const x = from.x + (to.x - from.x) * f;
  const z = from.z + (to.z - from.z) * f;
  const side = (x - p.x) * p.rx + (z - p.z) * p.rz;
  return Math.abs(side) <= halfWidth ? f : null;
}

/** "1:02.345" */
export function formatTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

/** "+1.234" / "-0.500" */
export function formatDelta(seconds: number): string {
  return `${seconds >= 0 ? "+" : "-"}${Math.abs(seconds).toFixed(3)}`;
}
