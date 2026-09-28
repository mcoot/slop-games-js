import { RAPIER, type PhysicsWorld } from "@slop/physics";
import type { CourseData } from "./data";
import { RAIL_HEIGHT, type Route } from "./route";

/** Tall enough for the pines along the walk. */
export const TREE_HEIGHT = 11;

export interface CoursePhysics {
  terrain: RAPIER.Collider;
  buildings: RAPIER.Collider;
  trees: RAPIER.Collider[];
  rails: RAPIER.Collider[];
  dispose(): void;
}

/** Colliders for a course: the terrain as a heightfield, buildings as one triangle mesh, tree trunks, railings. */
export function buildCoursePhysics(world: PhysicsWorld, course: CourseData, route: Route): CoursePhysics {
  const t = course.terrain;
  // Rapier heightfields are column-major with rows along Z, centred on their translation.
  const nrows = t.rows - 1;
  const ncols = t.cols - 1;
  const heights = new Float32Array(t.rows * t.cols);
  for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) heights[c * t.rows + r] = t.heights[r * t.cols + c]!;
  const sx = ncols * t.cell;
  const sz = nrows * t.cell;
  const terrain = world.createCollider(
    RAPIER.ColliderDesc.heightfield(nrows, ncols, heights, { x: sx, y: 1, z: sz }).setTranslation(t.x0 + sx / 2, 0, t.z0 + sz / 2),
  );
  const b = buildingGeometry(course);
  const buildings = world.createCollider(RAPIER.ColliderDesc.trimesh(b.positions, b.indices));
  const trees = course.trees.map(([x, y, z]) =>
    world.createCollider(RAPIER.ColliderDesc.cylinder(TREE_HEIGHT / 2, 0.35).setTranslation(x, y + TREE_HEIGHT / 2 - 0.5, z)),
  );
  // Railings as thin boxes, reaching a little into the ground so slopes don't open gaps.
  const rails = route.rails.map(({ a, b }) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    const base = Math.min(a.y, b.y) - 0.6;
    const top = Math.max(a.y, b.y) + RAIL_HEIGHT;
    return world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.05, (top - base) / 2, len / 2 + 0.05)
        .setTranslation((a.x + b.x) / 2, (top + base) / 2, (a.z + b.z) / 2)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
    );
  });
  return {
    terrain,
    buildings,
    trees,
    rails,
    dispose() {
      for (const c of [terrain, buildings, ...trees, ...rails]) world.removeCollider(c, false);
    },
  };
}

/** Extruded footprints (walls and a flat roof), for both physics and rendering. */
export function buildingGeometry(course: CourseData): { positions: Float32Array; indices: Uint32Array; roofStart: number } {
  const pos: number[] = [];
  const idx: number[] = [];
  const roofs: number[] = [];
  for (const b of course.buildings) {
    // Walls face outwards when the footprint runs with negative shoelace area in (x, z).
    let ring = b.footprint;
    if (signedArea(ring) > 0) ring = ring.slice().reverse();
    const top = b.base + b.height;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i]!;
      const [bx, bz] = ring[(i + 1) % ring.length]!;
      const v = pos.length / 3;
      pos.push(ax, b.base, az, bx, b.base, bz, bx, top, bz, ax, top, az);
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    const v0 = pos.length / 3;
    for (const [x, z] of ring) pos.push(x, top, z);
    // Ear clipping wants positive area: triangulate the reversed ring and map back.
    const last = ring.length - 1;
    for (const [i, j, k] of triangulate(ring.slice().reverse())) roofs.push(v0 + last - i, v0 + last - k, v0 + last - j);
  }
  const roofStart = idx.length;
  idx.push(...roofs);
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), roofStart };
}

/** Shoelace area in (x, z). */
function signedArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i]!;
    const [x2, z2] = ring[(i + 1) % ring.length]!;
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

/** Ear clipping for a simple polygon with positive signed area. Returns index triples. */
function triangulate(ring: [number, number][]): [number, number, number][] {
  const out: [number, number, number][] = [];
  const idx = ring.map((_, i) => i);
  const cross = (a: number, b: number, c: number) => {
    const [ax, az] = ring[a]!;
    const [bx, bz] = ring[b]!;
    const [cx, cz] = ring[c]!;
    return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  };
  const inside = (p: number, a: number, b: number, c: number) => cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length]!;
      const b = idx[i]!;
      const c = idx[(i + 1) % idx.length]!;
      if (cross(a, b, c) <= 0) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate: give up on the rest
  }
  if (idx.length === 3 && cross(idx[0]!, idx[1]!, idx[2]!) > 0) out.push([idx[0]!, idx[1]!, idx[2]!]);
  return out;
}
