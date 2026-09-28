import { heightAt, type CourseData, type Vec3 } from "./data";

/**
 * The race line over the real walk: a smoothed centreline (for gate orientation and
 * finding your way) and the gates at each landmark. You ski the actual terrain; the
 * walk is just the way the course goes.
 */
export interface RouteSettings {
  /** How far (m) the centreline smooths out the path's wiggles. */
  smoothing: number;
  /** Centreline sample spacing (m). */
  step: number;
  /** How far along the walk the start gate is from where you start (m). */
  startRunUp: number;
}

export const defaultRoute: RouteSettings = { smoothing: 16, step: 2, startRunUp: 10 };

export interface Sample {
  /** Distance along the centreline (m). */
  s: number;
  x: number;
  z: number;
  /** Ground height here. */
  y: number;
  /** Unit tangent (horizontal) and right vector. */
  tx: number;
  tz: number;
  rx: number;
  rz: number;
}

export interface Gate {
  name: string;
  index: number;
  /** Centreline sample nearest the gate (for ordering and respawns). */
  sample: Sample;
  /** Where the walk crosses it, on the ground. */
  pathPoint: Vec3;
  /** The arch you have to pass through: centred on the walk, across it. */
  arch: Arch;
}

export interface Arch {
  x: number;
  z: number;
  /** Unit direction of travel through it (horizontal) and across it. */
  tx: number;
  tz: number;
  rx: number;
  rz: number;
  halfWidth: number;
  bottom: number;
  top: number;
}

/** Arch size: wide enough for a line or two, low enough that you can't jet over it by accident. */
export const ARCH_HALF_WIDTH = 9;
export const ARCH_HEIGHT = 12;

/** A stretch of cliff-top railing beside the walk: from a to b (on the ground), 1.1 m tall. */
export interface Rail {
  a: Vec3;
  b: Vec3;
}

export const RAIL_HEIGHT = 1.1;

export interface Route {
  settings: RouteSettings;
  /** Railings along the walk wherever the ground drops away beside it, like the real ones. */
  rails: Rail[];
  samples: Sample[];
  gates: Gate[];
  /** Index of the sample nearest a point (horizontally). */
  nearestSample(x: number, z: number): number;
  /** Where to put a player (re)starting at a gate: 0 is the start, behind the start gate. */
  respawn(gateIndex: number): { position: Vec3; yaw: number; velocity: Vec3 };
}

export function buildRoute(course: CourseData, settings: RouteSettings = defaultRoute): Route {
  const s = settings;
  // Smooth the walk (anchored ends), then resample it evenly.
  let pts = course.path.map(([x, , z]) => [x, z] as [number, number]);
  const window = Math.max(1, Math.round(s.smoothing / 4));
  for (let pass = 0; pass < 3; pass++) {
    pts = pts.map((p, i) => {
      if (i === 0 || i === pts.length - 1) return p;
      const k = Math.min(window, i, pts.length - 1 - i);
      let sx = 0;
      let sz = 0;
      for (let j = i - k; j <= i + k; j++) {
        sx += pts[j]![0];
        sz += pts[j]![1];
      }
      return [sx / (2 * k + 1), sz / (2 * k + 1)];
    });
  }
  const line = resample(pts, s.step);
  const samples: Sample[] = line.map(([x, z], i) => {
    const [px, pz] = line[Math.max(i - 1, 0)]!;
    const [nx, nz] = line[Math.min(i + 1, line.length - 1)]!;
    const len = Math.hypot(nx - px, nz - pz) || 1;
    const tx = (nx - px) / len;
    const tz = (nz - pz) / len;
    return { s: i * s.step, x, z, y: heightAt(course.terrain, x, z), tx, tz, rx: -tz, rz: tx };
  });

  const BUCKET = 16;
  const buckets = new Map<string, number[]>();
  samples.forEach((p, i) => {
    const k = `${Math.floor(p.x / BUCKET)},${Math.floor(p.z / BUCKET)}`;
    buckets.set(k, [...(buckets.get(k) ?? []), i]);
  });
  const nearestSample = (x: number, z: number) => {
    const bx = Math.floor(x / BUCKET);
    const bz = Math.floor(z / BUCKET);
    let best = -1;
    let bestD = Infinity;
    for (let r = 1; r <= 64 && (best < 0 || r <= 2); r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          for (const i of buckets.get(`${bx + dx},${bz + dz}`) ?? []) {
            const d = (samples[i]!.x - x) ** 2 + (samples[i]!.z - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
    }
    return Math.max(best, 0);
  };

  // Gates where each checkpoint's path point is nearest the centreline; the start gate
  // a short run-up along from where you start.
  const gates: Gate[] = course.checkpoints.map((cp, index) => {
    const [x, y, z] = course.path[cp.index]!;
    let i = nearestSample(x, z);
    if (index === 0) i = Math.round(s.startRunUp / s.step);
    if (index === course.checkpoints.length - 1) i = samples.length - 1;
    const sample = samples[i]!;
    const pathPoint = index === 0 ? { x: sample.x, y: sample.y, z: sample.z } : { x, y, z };
    // Across the walk's own direction here (smoothed over a few points).
    let tx = sample.tx;
    let tz = sample.tz;
    if (index > 0) {
      const [ax, , az] = course.path[Math.max(cp.index - 4, 0)]!;
      const [bx, , bz] = course.path[Math.min(cp.index + 4, course.path.length - 1)]!;
      const len = Math.hypot(bx - ax, bz - az) || 1;
      tx = (bx - ax) / len;
      tz = (bz - az) / len;
    }
    const ground = Math.max(pathPoint.y, heightAt(course.terrain, pathPoint.x, pathPoint.z));
    let bottom = ground;
    for (const side of [-1, 1]) {
      bottom = Math.min(bottom, heightAt(course.terrain, pathPoint.x - tz * ARCH_HALF_WIDTH * side, pathPoint.z + tx * ARCH_HALF_WIDTH * side));
    }
    const arch: Arch = {
      x: pathPoint.x,
      z: pathPoint.z,
      tx,
      tz,
      rx: -tz,
      rz: tx,
      halfWidth: ARCH_HALF_WIDTH,
      bottom: bottom - 3,
      top: ground + ARCH_HEIGHT,
    };
    return { name: cp.name, index: i, sample, pathPoint, arch };
  });

  // Railings: along each side of the walk where the ground a few metres out is well
  // below the walk (a cliff edge or a steep bank down to the rocks), past the carved verge.
  const rails: Rail[] = [];
  const OFFSET = 2.8;
  const path = course.path;
  for (const side of [-1, 1]) {
    let run: Vec3[] = [];
    const flush = () => {
      for (let k = 0; k + 1 < run.length; k++) rails.push({ a: run[k]!, b: run[k + 1]! });
      run = [];
    };
    for (let i = 0; i < path.length; i++) {
      const [x, y, z] = path[i]!;
      const [px, , pz] = path[Math.max(i - 1, 0)]!;
      const [nx, , nz] = path[Math.min(i + 1, path.length - 1)]!;
      const len = Math.hypot(nx - px, nz - pz) || 1;
      const rx = (-(nz - pz) / len) * side;
      const rz = ((nx - px) / len) * side;
      const drop = y - heightAt(course.terrain, x + rx * 11, z + rz * 11);
      if (drop > 2.5) {
        const ax = x + rx * OFFSET;
        const az = z + rz * OFFSET;
        run.push({ x: ax, y: heightAt(course.terrain, ax, az), z: az });
      } else {
        flush();
      }
    }
    flush();
  }

  return {
    settings: s,
    rails,
    samples,
    gates,
    nearestSample,
    respawn(gateIndex) {
      const p = gateIndex <= 0 ? samples[0]! : gates[Math.min(gateIndex, gates.length - 1)]!.sample;
      const g = gateIndex <= 0 ? null : gates[gateIndex]!;
      const at = g ? g.pathPoint : { x: p.x, y: p.y, z: p.z };
      const speed = gateIndex <= 0 ? 0 : 8;
      return {
        position: { x: at.x, y: Math.max(at.y, heightAt(course.terrain, at.x, at.z)) + 0.3, z: at.z },
        yaw: yawOf(p.tx, p.tz),
        velocity: { x: p.tx * speed, y: 0, z: p.tz * speed },
      };
    },
  };
}

/** Yaw (controller convention: 0 looks down -Z, positive turns left) facing along (tx, tz). */
export function yawOf(tx: number, tz: number): number {
  return Math.atan2(-tx, -tz);
}

function resample(pts: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [pts[0]!];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]!;
    const [bx, bz] = pts[i + 1]!;
    const len = Math.hypot(bx - ax, bz - az);
    let d = step - carry;
    while (d <= len) {
      out.push([ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len]);
      d += step;
    }
    carry = len - (d - step);
  }
  const last = pts.at(-1)!;
  const tail = out.at(-1)!;
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push(last);
  return out;
}
