import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildLevel, PLAYER_SPAWN } from "@slop/level-loader";
import type { PhysicsWorld } from "@slop/physics";
import { heightAt, Surface, type CourseData, type Point3, type SurfaceClass } from "./data";
import type { Route } from "./route";
import type { V3 } from "../combat/damage";
import { sandstoneMaterial } from "../view/sandstone";

/**
 * Maps built in Blender (assets-src/maps/*.blend, exported with `pnpm export-maps`) and
 * set into the real coast: the file's `terrain` grid replaces the course's ground inside
 * the arena and blends into the real ground round it, everything else in the file is
 * drawn and collides, and marker empties give spawns, trees and benches. The rest of
 * Bondi stays as the backdrop. See tools/blender/build_sculpture_park.py for the conventions.
 */
export interface ArenaFile {
  /** Everything but the terrain, in course metres. */
  scene: THREE.Object3D;
  /** The file's ground per course terrain cell (row * cols + col). */
  heights: Map<number, number>;
  surfaces: Map<number, SurfaceClass>;
}

const SURFACES: Record<string, SurfaceClass> = {
  surf_grass: Surface.grass,
  surf_path: Surface.path,
  surf_rock: Surface.rock,
  surf_scrub: Surface.scrub,
  surf_sand: Surface.sand,
};
/** Where faces of different ground meet, the vertex takes the one that matters most to see. */
const PRIORITY: SurfaceClass[] = [Surface.grass, Surface.scrub, Surface.sand, Surface.rock, Surface.path];

/** Load a map's .glb from a URL (browser) or its bytes (tests), against the course's terrain grid. */
export async function loadArenaFile(source: string | ArrayBuffer, course: CourseData): Promise<ArenaFile> {
  const loader = new GLTFLoader();
  const gltf = typeof source === "string" ? await loader.loadAsync(source) : await loader.parseAsync(source, "");
  const scene = gltf.scene;
  scene.updateWorldMatrix(true, true);
  const t = course.terrain;
  const heights = new Map<number, number>();
  const surfaces = new Map<number, SurfaceClass>();
  const terrain = scene.getObjectByName("terrain");
  if (!terrain) throw new Error("map has no `terrain` object");
  const v = new THREE.Vector3();
  terrain.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const material = obj.material as THREE.Material;
    const surface = SURFACES[material.name] ?? Surface.grass;
    const pos = obj.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
      const c = Math.round((v.x - t.x0) / t.cell);
      const r = Math.round((v.z - t.z0) / t.cell);
      if (c < 0 || r < 0 || c >= t.cols || r >= t.rows) continue;
      const k = r * t.cols + c;
      heights.set(k, v.y);
      const had = surfaces.get(k);
      if (had === undefined || PRIORITY.indexOf(surface) > PRIORITY.indexOf(had)) surfaces.set(k, surface);
    }
  });
  terrain.removeFromParent();
  return { scene, heights, surfaces };
}

/** How far past the wall the file's ground is used as is, and where it has blended into the real ground (m). */
const SOLID_REACH = 10;
const BLEND_REACH = 40;

/** How far the blend reaches at a bearing: it wanders so the new ground's edge isn't a perfect circle. */
function blendReach(radius: number, angle: number): number {
  const wander = 1 + 0.35 * Math.sin(3 * angle + 1) + 0.2 * Math.sin(7 * angle + 2);
  return radius + SOLID_REACH + (BLEND_REACH - SOLID_REACH) * wander;
}
/** Past the wall, the furthest the blend reaches at any bearing: the patch the real coast is cleared from. */
const CLEAR_REACH = SOLID_REACH + (BLEND_REACH - SOLID_REACH) * 1.55;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Set the map into the course: its ground inside the arena, blended into the real ground
 * round it (steep blends become sandstone cliff), and the real buildings, trees, benches,
 * sculptures, pools and walk cleared from the whole patch. Call before anything is built
 * from the course.
 */
export function stampArena(course: CourseData, centre: { x: number; z: number }, radius: number, file: ArenaFile): void {
  const t = course.terrain;
  const inner = radius + SOLID_REACH;
  const outer = radius + CLEAR_REACH;
  const real = t.heights.slice();
  const c0 = Math.max(Math.floor((centre.x - outer - t.x0) / t.cell), 0);
  const c1 = Math.min(Math.ceil((centre.x + outer - t.x0) / t.cell), t.cols - 1);
  const r0 = Math.max(Math.floor((centre.z - outer - t.z0) / t.cell), 0);
  const r1 = Math.min(Math.ceil((centre.z + outer - t.z0) / t.cell), t.rows - 1);
  const cellOf = (x: number, z: number) => Math.round((z - t.z0) / t.cell) * t.cols + Math.round((x - t.x0) / t.cell);
  const blended: number[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const x = t.x0 + c * t.cell;
      const z = t.z0 + r * t.cell;
      const d = Math.hypot(x - centre.x, z - centre.z);
      const reach = blendReach(radius, Math.atan2(z - centre.z, x - centre.x));
      if (d > reach) continue;
      const k = r * t.cols + c;
      if (d <= inner) {
        const h = file.heights.get(k);
        if (h === undefined) continue;
        t.heights[k] = h;
        t.surface[k] = file.surfaces.get(k) ?? Surface.grass;
        continue;
      }
      // Past the file's reach: its edge height straight in towards the middle, easing into the real ground.
      const s = (inner - 1) / d;
      const edge = file.heights.get(cellOf(centre.x + (x - centre.x) * s, centre.z + (z - centre.z) * s));
      if (edge === undefined) continue;
      const w = smoothstep(reach, inner, d);
      t.heights[k] = edge * w + real[k]! * (1 - w);
      if (t.heights[k]! > 0.3 && t.surface[k] === Surface.sea) t.surface[k] = Surface.rock;
      // The houses here are cleared away: the park runs on over their lots.
      if (t.surface[k] === Surface.urban) t.surface[k] = Surface.grass;
      blended.push(k);
    }
  }
  // Where the blend is steep it's a cliff.
  for (const k of blended) {
    if (t.heights[k]! <= 0.3) continue;
    const h = t.heights;
    const slope = Math.max(Math.abs(h[k + 1]! - h[k]!), Math.abs(h[k - 1]! - h[k]!), Math.abs(h[k + t.cols]! - h[k]!), Math.abs(h[k - t.cols]! - h[k]!)) / t.cell;
    if (slope > 0.7) t.surface[k] = Surface.rock;
  }

  const clear = (x: number, z: number, margin = 0) => Math.hypot(x - centre.x, z - centre.z) > outer + margin;
  const outside = (p: Point3) => clear(p[0], p[2]);
  course.buildings = course.buildings.filter((b) => b.footprint.every(([x, z]) => clear(x, z, 6)));
  course.trees = course.trees.filter(outside);
  course.benches = course.benches.filter(outside);
  course.sculptures = course.sculptures.filter(outside);
  course.pools = course.pools.filter((ring) => ring.every(([x, z]) => clear(x, z)));
  course.pathHidden = Uint8Array.from(course.path, (p) => (outside(p) ? 0 : 1));

  // The file's own trees and benches, drawn and colliding like the real ones.
  const trees: Point3[] = [];
  file.scene.traverse((obj) => {
    const type = obj.userData.type;
    if (type !== "tree" && type !== "bench") return;
    const p = obj.getWorldPosition(new THREE.Vector3());
    const at: Point3 = [p.x, heightAt(t, p.x, p.z), p.z];
    if (type === "tree") trees.push(at);
    else course.benches.push(at);
  });
  addPines(course.trees, trees);
}

/**
 * The course view makes some trees pines and the rest round coastal trees by their place
 * in the list. The map's trees are Norfolk Island pines, so each goes into a pine's place
 * (the tree that was there, somewhere else on the coast, moves to the end).
 */
function addPines(all: Point3[], pines: Point3[]): void {
  const isPine = (i: number) => {
    const x = Math.sin(i * 3.3 * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x) < 0.55;
  };
  let i = 0;
  for (const p of pines) {
    while (!isPine(i)) i++;
    if (i < all.length) all.push(all[i]!);
    all[i++] = p;
  }
}

/** Clear the real walk's railings from an arena patch (after the route is built, before its physics and view). */
export function clearRoute(route: Route, centre: { x: number; z: number }, radius: number): void {
  const outer = radius + CLEAR_REACH;
  const out = (p: { x: number; z: number }) => Math.hypot(p.x - centre.x, p.z - centre.z) > outer;
  route.rails = route.rails.filter((r) => out(r.a) && out(r.b));
}

export interface ArenaStructures {
  /** Drawn: the file's visible meshes merged by material. */
  root: THREE.Group;
  spawns: V3[];
  colliders: number;
}

/**
 * Add the file's structures to the world (level-loader conventions) and draw them,
 * merged into one mesh per material so a map of many blocks is a handful of draws.
 * `environment` lights the polished steel.
 */
export function buildArenaStructures(world: PhysicsWorld, file: ArenaFile, environment: THREE.Texture | null): ArenaStructures {
  const level = buildLevel(world, file.scene);
  const spawns = (level.markers.get(PLAYER_SPAWN) ?? []).map((m) => ({ ...m.position }));

  const byMaterial = new Map<string, { material: THREE.Material; geoms: THREE.BufferGeometry[]; shadow: boolean }>();
  file.scene.updateWorldMatrix(true, true);
  file.scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.visible) return;
    let hidden = false;
    obj.traverseAncestors((a) => (hidden ||= !a.visible));
    if (hidden) return;
    const source = obj.material as THREE.MeshStandardMaterial;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", obj.geometry.getAttribute("position"));
    g.setAttribute("normal", obj.geometry.getAttribute("normal"));
    g.setIndex(obj.geometry.getIndex());
    const geom = g.toNonIndexed().applyMatrix4(obj.matrixWorld);
    let entry = byMaterial.get(source.name);
    if (!entry) {
      entry = { material: materialFor(source, environment), geoms: [], shadow: source.name !== "team_north" && source.name !== "team_south" };
      byMaterial.set(source.name, entry);
    }
    entry.geoms.push(geom);
  });
  const root = new THREE.Group();
  root.name = "arena";
  for (const { material, geoms, shadow } of byMaterial.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geoms)!, material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    root.add(mesh);
    for (const g of geoms) g.dispose();
  }
  return { root, spawns, colliders: level.colliders.length };
}

/** The game's look for a Blender material: sandstone gets the cliffs' strata (dressed stone stays plain), steel reflects the sky, the rest is matte. */
function materialFor(source: THREE.MeshStandardMaterial, environment: THREE.Texture | null): THREE.Material {
  if (source.name === "sandstone") return sandstoneMaterial({ perVertex: false });
  if (source.metalness > 0.5 && environment) {
    return new THREE.MeshStandardMaterial({ color: source.color, metalness: source.metalness, roughness: source.roughness, envMap: environment, envMapIntensity: 1.2 });
  }
  return new THREE.MeshLambertMaterial({ color: source.color });
}
