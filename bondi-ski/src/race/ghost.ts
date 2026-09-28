/**
 * A recorded run: positions and view yaw against race time, played back as a ghost.
 * The same shape is what a networked racer would stream, so remote players can be
 * drawn with the same view.
 */
export interface GhostFrame {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export class GhostRecorder {
  private frames: number[] = [];
  private lastT = -Infinity;

  constructor(private readonly interval = 1 / 30) {}

  reset(): void {
    this.frames = [];
    this.lastT = -Infinity;
  }

  record(t: number, x: number, y: number, z: number, yaw: number, force = false): void {
    if (!force && t - this.lastT < this.interval) return;
    this.frames.push(t, x, y, z, yaw);
    this.lastT = t;
  }

  finish(): Ghost {
    return new Ghost(Float32Array.from(this.frames));
  }
}

export class Ghost {
  /** Flat [t, x, y, z, yaw, ...]. */
  constructor(readonly data: Float32Array) {}

  get duration(): number {
    return this.data.length >= 5 ? this.data[this.data.length - 5]! : 0;
  }

  /** Interpolated frame at time `t` (clamped to the recording). */
  sample(t: number, out: GhostFrame = { t: 0, x: 0, y: 0, z: 0, yaw: 0 }): GhostFrame | null {
    const d = this.data;
    const n = d.length / 5;
    if (n === 0) return null;
    // Binary search for the last frame at or before t.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (d[mid * 5]! <= t) lo = mid;
      else hi = mid - 1;
    }
    const i = lo * 5;
    const j = Math.min(lo + 1, n - 1) * 5;
    const span = d[j]! - d[i]!;
    const a = span > 0 ? Math.min(Math.max((t - d[i]!) / span, 0), 1) : 0;
    out.t = t;
    out.x = d[i + 1]! + (d[j + 1]! - d[i + 1]!) * a;
    out.y = d[i + 2]! + (d[j + 2]! - d[i + 2]!) * a;
    out.z = d[i + 3]! + (d[j + 3]! - d[i + 3]!) * a;
    let dy = d[j + 4]! - d[i + 4]!;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    out.yaw = d[i + 4]! + dy * a;
    return out;
  }

  toBase64(): string {
    const bytes = new Uint8Array(this.data.buffer, this.data.byteOffset, this.data.byteLength);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  static fromBase64(b64: string): Ghost {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return new Ghost(new Float32Array(bytes.buffer));
  }
}

/** A personal best for a course, kept in this browser. */
export interface BestRun {
  time: number;
  splits: number[];
  ghost: Ghost;
}

export function loadBest(course: string): BestRun | null {
  try {
    const raw = localStorage.getItem(`bondi-ski.best.${course}`);
    if (!raw) return null;
    const j = JSON.parse(raw) as { time: number; splits: number[]; ghost: string };
    return { time: j.time, splits: j.splits, ghost: Ghost.fromBase64(j.ghost) };
  } catch {
    return null;
  }
}

export function saveBest(course: string, run: BestRun): void {
  try {
    localStorage.setItem(`bondi-ski.best.${course}`, JSON.stringify({ time: run.time, splits: run.splits, ghost: run.ghost.toBase64() }));
  } catch {
    // storage unavailable or full: the best still lasts this session
  }
}

export function clearBest(course: string): void {
  try {
    localStorage.removeItem(`bondi-ski.best.${course}`);
  } catch {
    // storage unavailable
  }
}
