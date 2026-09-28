/**
 * A course as built by tools/build-course.mjs from OpenStreetMap and elevation data.
 * Local metres: +X east, -Z north, Y up, sea level at 0.
 */
export type Vec3 = { x: number; y: number; z: number };
export type Point3 = [number, number, number];

/** Surface class per terrain cell. Keep in sync with tools/build-course.mjs. */
export const Surface = { urban: 0, grass: 1, sand: 2, rock: 3, sea: 4, road: 5, path: 6, scrub: 7 } as const;
export type SurfaceClass = (typeof Surface)[keyof typeof Surface];

export interface CourseJson {
  name: string;
  title: string;
  attribution: string[];
  origin: { lat: number; lon: number };
  osmTimestamp?: string;
  terrain: { x0: number; z0: number; cell: number; cols: number; rows: number; file: string };
  /** The walk from start to finish, every ~2 m, on the ground. */
  path: Point3[];
  length: number;
  /** In course order; `index` is into `path`. The first is the start, the last the finish. */
  checkpoints: { name: string; index: number; distance: number }[];
  buildings: { footprint: [number, number][]; base: number; height: number; kind: string }[];
  trees: Point3[];
  benches: Point3[];
  sculptures: Point3[];
  pools: [number, number][][];
}

export interface Terrain {
  x0: number;
  z0: number;
  cell: number;
  cols: number;
  rows: number;
  /** Row-major, rows along +Z. */
  heights: Float32Array;
  surface: Uint8Array;
}

export interface CourseData extends Omit<CourseJson, "terrain"> {
  terrain: Terrain;
}

/** Parse the course from its JSON and binary files (fetched in the browser, read from disk in tests). */
export function parseCourse(json: CourseJson, bin: ArrayBuffer): CourseData {
  const { cols, rows } = json.terrain;
  const n = cols * rows;
  const raw = new DataView(bin);
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) heights[i] = raw.getInt16(i * 2, true) / 10;
  const surface = new Uint8Array(bin, n * 2, n).slice();
  return { ...json, terrain: { ...json.terrain, heights, surface } };
}

export async function loadCourse(baseUrl: string, name: string): Promise<CourseData> {
  const json = (await (await fetch(`${baseUrl}${name}.json`)).json()) as CourseJson;
  const bin = await (await fetch(`${baseUrl}${json.terrain.file}`)).arrayBuffer();
  return parseCourse(json, bin);
}

/** Bilinear terrain height at a point (clamped to the grid). */
export function heightAt(t: Terrain, x: number, z: number): number {
  const fx = Math.min(Math.max((x - t.x0) / t.cell, 0), t.cols - 1.001);
  const fz = Math.min(Math.max((z - t.z0) / t.cell, 0), t.rows - 1.001);
  const c = Math.floor(fx);
  const r = Math.floor(fz);
  const ax = fx - c;
  const az = fz - r;
  const i = r * t.cols + c;
  const h = t.heights;
  return (h[i]! * (1 - ax) + h[i + 1]! * ax) * (1 - az) + (h[i + t.cols]! * (1 - ax) + h[i + t.cols + 1]! * ax) * az;
}

/** The terrain's smooth normal at a point, from the bilinear surface's slope. */
export function terrainNormal(t: Terrain, x: number, z: number): Vec3 {
  const e = t.cell * 0.5;
  const gx = (heightAt(t, x + e, z) - heightAt(t, x - e, z)) / (2 * e);
  const gz = (heightAt(t, x, z + e) - heightAt(t, x, z - e)) / (2 * e);
  const len = Math.hypot(gx, 1, gz);
  return { x: -gx / len, y: 1 / len, z: -gz / len };
}

export function surfaceAt(t: Terrain, x: number, z: number): SurfaceClass {
  const c = Math.min(Math.max(Math.round((x - t.x0) / t.cell), 0), t.cols - 1);
  const r = Math.min(Math.max(Math.round((z - t.z0) / t.cell), 0), t.rows - 1);
  return t.surface[r * t.cols + c] as SurfaceClass;
}

/** In the water: at the surface over a sea cell, or anywhere below the waterline. */
export function inSea(t: Terrain, p: Vec3): boolean {
  return p.y < -1.2 || (p.y < 0.4 && surfaceAt(t, p.x, p.z) === Surface.sea);
}
