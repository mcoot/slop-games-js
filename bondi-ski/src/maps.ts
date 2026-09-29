import { heightAt, surfaceAt, Surface, type CourseData } from "./course/data";
import type { Route } from "./course/route";
import type { V3 } from "./combat/damage";

/**
 * A deathmatch map: a patch of the course and how the fight is bounded on it. Arena maps
 * (Tribes: Ascend style) are a small circle of the real coast inside a force-field wall,
 * with the rest of Bondi as the backdrop; the coastal walk is the whole course.
 */
export interface MapDef {
  id: string;
  title: string;
  /** One line for the title card. */
  blurb: string;
  /** Middle of the fight (local metres). */
  centre: { x: number; z: number };
  /** How far from the middle you can go (m). */
  radius: number;
  /** A solid force field at `radius`; otherwise the edge only hurts. */
  walled: boolean;
  /**
   * Built in Blender: `public/maps/<level>.glb` replaces the ground inside the wall and
   * brings its own structures and spawns (see `course/arenaLevel.ts`).
   */
  level?: string;
}

export const MAPS: MapDef[] = [
  {
    id: "marks-park",
    title: "Marks Park",
    blurb: "The grassy headland between Bondi and Tamarama: a 30 m hill to ski off, cliffs all round, walled in.",
    centre: { x: 205, z: 115 },
    radius: 115,
    walled: true,
  },
  {
    id: "sculpture-park",
    title: "Sculpture Park",
    blurb: "Marks Park rebuilt for a fight during Sculptures by the Sea: a walled sandstone compound at each end, a ski valley of sculptures between, walled in.",
    centre: { x: 201, z: 111 },
    radius: 125,
    walled: true,
    level: "sculpture-park",
  },
  {
    id: "bondi-beach",
    title: "Bondi Beach",
    blurb: "The south end of the beach: ski down the park bank and across the sand, the surf at your back, walled in.",
    centre: { x: 280, z: -660 },
    radius: 150,
    walled: true,
  },
  {
    id: "coastal-walk",
    title: "Coastal walk",
    blurb: "The whole walk from Icebergs to Tamarama, open to the horizon. Big, spread out and fast.",
    centre: { x: 0, z: 0 },
    radius: 420,
    walled: false,
  },
];

export const DEFAULT_MAP = MAPS[0]!;

export function mapById(id: string | null | undefined): MapDef {
  return MAPS.find((m) => m.id === id) ?? DEFAULT_MAP;
}

/** Where the fight happens on a map, worked out against the course. */
export interface ArenaLayout {
  map: MapDef;
  centre: V3;
  radius: number;
  walled: boolean;
  spawns: V3[];
}

/** `spawns` are the map's own (a Blender-built map's markers); otherwise they're worked out. */
export function layoutFor(map: MapDef, course: CourseData, route: Route, spawns?: V3[]): ArenaLayout {
  if (!map.walled) {
    // The coastal walk: the middle of the course, spawns along the walk.
    const mid = route.samples[Math.floor(route.samples.length / 2)]!;
    return { map, centre: { x: mid.x, y: mid.y, z: mid.z }, radius: map.radius, walled: false, spawns: routeSpawns(course, route) };
  }
  const t = course.terrain;
  const { x, z } = map.centre;
  return { map, centre: { x, y: heightAt(t, x, z), z }, radius: map.radius, walled: true, spawns: spawns?.length ? spawns : ringSpawns(course, map) };
}

/** Standing room: on land above the waterline and not inside a building. */
function standable(course: CourseData, x: number, z: number): boolean {
  const t = course.terrain;
  if (heightAt(t, x, z) < 1.5 || surfaceAt(t, x, z) === Surface.sea) return false;
  return !course.buildings.some((b) => nearFootprint(b.footprint, x, z, 3));
}

/** Spawns spread over an arena: rings of points inside the wall, skipping water and buildings. */
function ringSpawns(course: CourseData, map: MapDef): V3[] {
  const out: V3[] = [];
  const t = course.terrain;
  for (const f of [0.35, 0.6, 0.8]) {
    const n = Math.round(8 * f * (map.radius / 100)) + 4;
    for (let i = 0; i < n; i++) {
      const a = ((i + f) / n) * Math.PI * 2;
      const x = map.centre.x + Math.cos(a) * map.radius * f;
      const z = map.centre.z + Math.sin(a) * map.radius * f;
      if (!standable(course, x, z)) continue;
      out.push({ x, y: heightAt(t, x, z) + 0.4, z });
    }
  }
  if (out.length === 0) out.push({ x: map.centre.x, y: heightAt(t, map.centre.x, map.centre.z) + 0.4, z: map.centre.z });
  return out;
}

/** Where to (re)spawn on the coastal walk: on land along the course, a little either side of the walk. */
function routeSpawns(course: CourseData, route: Route): V3[] {
  const out: V3[] = [];
  const t = course.terrain;
  for (let i = 5; i < route.samples.length - 5; i += 12) {
    const s = route.samples[i]!;
    for (const off of [0, -14, 14]) {
      const x = s.x + s.rx * off;
      const z = s.z + s.rz * off;
      const y = heightAt(t, x, z);
      if (y < 1.5 || surfaceAt(t, x, z) === Surface.sea) continue;
      out.push({ x, y: y + 0.4, z });
      break;
    }
  }
  return out;
}

/** Is (x, z) within `margin` of the footprint's bounding box? Cheap, and generous on purpose. */
function nearFootprint(ring: [number, number][], x: number, z: number, margin: number): boolean {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [px, pz] of ring) {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minZ = Math.min(minZ, pz);
    maxZ = Math.max(maxZ, pz);
  }
  return x > minX - margin && x < maxX + margin && z > minZ - margin && z < maxZ + margin;
}
