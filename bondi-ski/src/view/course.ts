import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Surface, heightAt, type CourseData } from "../course/data";
import { RAIL_HEIGHT, type Route } from "../course/route";
import { buildingGeometry, TREE_HEIGHT } from "../course/physics";
import { sandstoneMaterial } from "./sandstone";

/**
 * Everything drawn for a course, stylised rather than photographic: warm sandstone,
 * pale suburban blocks, Norfolk Island pines, the concrete walk, and a gate over the
 * walk at each landmark.
 */
export interface CourseView {
  root: THREE.Group;
  gates: GateView[];
  /** Once a frame: pick each terrain chunk's detail from the camera's position. */
  update(camera: THREE.Vector3): void;
}

export interface GateView {
  root: THREE.Group;
  setState(state: "next" | "passed" | "ahead"): void;
}

const rand = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function buildCourseView(course: CourseData, route: Route): CourseView {
  const root = new THREE.Group();
  const terrain = terrainMesh(course);
  root.add(terrain.root);
  root.add(walkMesh(course));
  root.add(buildingsMesh(course));
  root.add(poolsMesh(course));
  root.add(treesMesh(course));
  root.add(heathMesh(course));
  root.add(propsMesh(course));
  root.add(railsMesh(route));
  const gates = route.gates.map((g, i) => gateView(course, route, i, g.name));
  for (const g of gates) root.add(g.root);
  return { root, gates, update: (camera) => terrain.update(camera) };
}

// ------------------------------------------------------------------ terrain

const SURFACE_COLOURS: Record<number, THREE.Color> = {
  [Surface.urban]: new THREE.Color("#c9c0ae"),
  [Surface.grass]: new THREE.Color("#7bab4f"),
  [Surface.sand]: new THREE.Color("#ecd9a8"),
  [Surface.rock]: new THREE.Color("#c98a4b"),
  [Surface.sea]: new THREE.Color("#b89f6e"),
  [Surface.road]: new THREE.Color("#6e6d6b"),
  [Surface.path]: new THREE.Color("#d2cbbd"),
  [Surface.scrub]: new THREE.Color("#5f7f3e"),
};

/** Terrain chunk size (cells), the detail levels (every nth cell) and how far out each is used (m). */
const CHUNK = 48;
const LOD_STEPS = [1, 2, 4, 8];
const LOD_RANGES = [200, 420, 850];
/** How far chunk edges hang down, to cover the cracks where detail levels meet (m). */
const SKIRT = 4;

/**
 * The ground: one grid of vertices (3 m apart), drawn as chunks that each pick a level
 * of detail by distance, so only the ground near you is drawn at full resolution. All
 * chunks share the vertex data; each level is just a different index list, plus skirts
 * hanging from the chunk edges so coarse and fine neighbours don't show gaps.
 */
function terrainMesh(course: CourseData): { root: THREE.Group; update(camera: THREE.Vector3): void } {
  const t = course.terrain;
  const n = t.cols * t.rows;
  // Per-cell colour and rockiness, then a blur so 4 m cells don't read as pixels.
  const base = new Float32Array(n * 3);
  const rockBase = new Float32Array(n);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const s = t.surface[i]!;
    const y = t.heights[i]!;
    c.copy(SURFACE_COLOURS[s]!);
    if (y < 1.2 && s !== Surface.sea) c.multiplyScalar(0.8 + Math.max(y, 0) * 0.15); // wet near the waterline
    c.offsetHSL(0, 0, (rand(i) - 0.5) * 0.04);
    base.set([c.r, c.g, c.b], i * 3);
    rockBase[i] = s === Surface.rock || (s === Surface.sea && y > -3) ? 1 : 0;
  }
  const col = new Float32Array(n * 3);
  const rock = new Float32Array(n);
  const pos = new Float32Array(n * 3);
  for (let r = 0; r < t.rows; r++) {
    for (let k = 0; k < t.cols; k++) {
      const i = r * t.cols + k;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let rk = 0;
      let w = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dk = -1; dk <= 1; dk++) {
          const rr = Math.min(Math.max(r + dr, 0), t.rows - 1);
          const kk = Math.min(Math.max(k + dk, 0), t.cols - 1);
          const j = rr * t.cols + kk;
          const wt = dr === 0 && dk === 0 ? 2 : 1;
          cr += base[j * 3]! * wt;
          cg += base[j * 3 + 1]! * wt;
          cb += base[j * 3 + 2]! * wt;
          rk += rockBase[j]! * wt;
          w += wt;
        }
      }
      col.set([cr / w, cg / w, cb / w], i * 3);
      rock[i] = rk / w;
      pos.set([t.x0 + k * t.cell, t.heights[i]!, t.z0 + r * t.cell], i * 3);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r + 1 < t.rows; r++) {
    for (let k = 0; k + 1 < t.cols; k++) {
      const a = r * t.cols + k;
      idx.push(a, a + t.cols, a + 1, a + 1, a + t.cols, a + t.cols + 1);
    }
  }
  // Normals from the full-resolution grid, so every level of detail is lit the same.
  const full = new THREE.BufferGeometry();
  full.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  full.setIndex(idx);
  full.computeVertexNormals();
  const nrm = full.getAttribute("normal").array as Float32Array;
  full.dispose();

  // Skirt vertices: a lowered copy of every vertex on a chunk edge.
  const onEdge = (r: number, k: number) => r % CHUNK === 0 || k % CHUNK === 0 || r === t.rows - 1 || k === t.cols - 1;
  const skirtOf = new Int32Array(n).fill(-1);
  let extra = 0;
  for (let r = 0; r < t.rows; r++) for (let k = 0; k < t.cols; k++) if (onEdge(r, k)) skirtOf[r * t.cols + k] = n + extra++;
  const total = n + extra;
  const grow = (a: Float32Array, size: number) => {
    const out = new Float32Array(total * size);
    out.set(a);
    for (let i = 0; i < n; i++) {
      const j = skirtOf[i]!;
      if (j >= 0) for (let c = 0; c < size; c++) out[j * size + c] = a[i * size + c]!;
    }
    return out;
  };
  const allPos = grow(pos, 3);
  for (let i = 0; i < n; i++) if (skirtOf[i]! >= 0) allPos[skirtOf[i]! * 3 + 1]! -= SKIRT;
  const attrs = {
    position: new THREE.BufferAttribute(allPos, 3),
    normal: new THREE.BufferAttribute(grow(nrm, 3), 3),
    color: new THREE.BufferAttribute(grow(col, 3), 3),
    rock: new THREE.BufferAttribute(grow(rock, 1), 1),
  };

  const material = sandstoneMaterial({ perVertex: true, vertexColors: true });
  const root = new THREE.Group();
  root.name = "terrain";
  const chunks: { centre: THREE.Vector2; half: number; levels: THREE.Mesh[] }[] = [];
  /** Every `step`th index from a to b, always ending on b. */
  const span = (a: number, b: number, step: number) => {
    const out: number[] = [];
    for (let v = a; v < b; v += step) out.push(v);
    out.push(b);
    return out;
  };
  for (let r0 = 0; r0 < t.rows - 1; r0 += CHUNK) {
    for (let k0 = 0; k0 < t.cols - 1; k0 += CHUNK) {
      const r1 = Math.min(r0 + CHUNK, t.rows - 1);
      const k1 = Math.min(k0 + CHUNK, t.cols - 1);
      let lo = Infinity;
      let hi = -Infinity;
      for (let r = r0; r <= r1; r++) {
        for (let k = k0; k <= k1; k++) {
          lo = Math.min(lo, t.heights[r * t.cols + k]!);
          hi = Math.max(hi, t.heights[r * t.cols + k]!);
        }
      }
      const box = new THREE.Box3(
        new THREE.Vector3(t.x0 + k0 * t.cell, lo - SKIRT, t.z0 + r0 * t.cell),
        new THREE.Vector3(t.x0 + k1 * t.cell, hi, t.z0 + r1 * t.cell),
      );
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const levels = LOD_STEPS.map((step) => {
        const rs = span(r0, r1, step);
        const ks = span(k0, k1, step);
        const at = (r: number, k: number) => r * t.cols + k;
        const ix: number[] = [];
        for (let a = 0; a + 1 < rs.length; a++) {
          for (let b = 0; b + 1 < ks.length; b++) {
            const p00 = at(rs[a]!, ks[b]!);
            const p01 = at(rs[a]!, ks[b + 1]!);
            const p10 = at(rs[a + 1]!, ks[b]!);
            const p11 = at(rs[a + 1]!, ks[b + 1]!);
            ix.push(p00, p10, p01, p01, p10, p11);
          }
        }
        // Skirts along all four edges, wound both ways so they show from either side.
        const edge = (list: number[]) => {
          for (let e = 0; e + 1 < list.length; e++) {
            const a = list[e]!;
            const b = list[e + 1]!;
            const sa = skirtOf[a]!;
            const sb = skirtOf[b]!;
            ix.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
          }
        };
        edge(ks.map((k) => at(r0, k)));
        edge(ks.map((k) => at(r1, k)));
        edge(rs.map((r) => at(r, k0)));
        edge(rs.map((r) => at(r, k1)));
        const geom = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(attrs)) geom.setAttribute(name, attr);
        geom.setIndex(ix);
        geom.boundingBox = box;
        geom.boundingSphere = sphere;
        const mesh = new THREE.Mesh(geom, material);
        mesh.receiveShadow = true;
        mesh.visible = false;
        mesh.matrixAutoUpdate = false;
        root.add(mesh);
        return mesh;
      });
      const centre = new THREE.Vector2(t.x0 + ((k0 + k1) / 2) * t.cell, t.z0 + ((r0 + r1) / 2) * t.cell);
      chunks.push({ centre, half: (CHUNK * t.cell) / 2, levels });
    }
  }
  const update = (camera: THREE.Vector3) => {
    for (const c of chunks) {
      // Distance to the chunk's square, not its middle, so you never stand on a coarse one.
      const dx = Math.max(Math.abs(camera.x - c.centre.x) - c.half, 0);
      const dz = Math.max(Math.abs(camera.z - c.centre.y) - c.half, 0);
      const d = Math.hypot(dx, dz);
      let level = LOD_RANGES.findIndex((range) => d < range);
      if (level < 0) level = LOD_STEPS.length - 1;
      c.levels.forEach((m, i) => (m.visible = i === level));
    }
  };
  return { root, update };
}

/** The coastal walk itself: a pale concrete ribbon, 2.4 m wide, draped over the terrain. */
function walkMesh(course: CourseData): THREE.Mesh {
  const pts = course.path;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y, z] = pts[i]!;
    const [px, , pz] = pts[Math.max(i - 1, 0)]!;
    const [nx, , nz] = pts[Math.min(i + 1, pts.length - 1)]!;
    const len = Math.hypot(nx - px, nz - pz) || 1;
    const rx = -(nz - pz) / len;
    const rz = (nx - px) / len;
    for (const side of [-1.2, 1.2]) {
      const sx = x + rx * side;
      const sz = z + rz * side;
      pos.push(sx, Math.max(heightAt(course.terrain, sx, sz), y) + 0.12, sz);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geom,
    new THREE.MeshLambertMaterial({ color: "#e4e0d6", polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ buildings

const WALLS = ["#f2ede2", "#ece3cf", "#e8d7b9", "#f4f1ea", "#d9c3a5", "#c98f6b", "#e9d2c4", "#dcd8cc"].map((c) => new THREE.Color(c));
const ROOFS = ["#b25b3c", "#9e4f35", "#6d6f73", "#8b8e91", "#c46d45", "#e8e4dc"].map((c) => new THREE.Color(c));

function buildingsMesh(course: CourseData): THREE.Mesh {
  const b = buildingGeometry(course);
  // Unindex so walls and roofs get their own flat colours.
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(b.positions, 3));
  geom.setIndex(new THREE.BufferAttribute(b.indices, 1));
  const flat = geom.toNonIndexed();
  const count = flat.getAttribute("position").count;
  const colours = new Float32Array(count * 3);
  // Walls come first, six vertices per footprint edge, in building order.
  const c = new THREE.Color();
  const wallVerts: number[] = [];
  course.buildings.forEach((bd, i) => wallVerts.push(...Array<number>(bd.footprint.length * 6).fill(i)));
  for (let v = 0; v < wallVerts.length; v++) {
    const i = wallVerts[v]!;
    const bd = course.buildings[i]!;
    const wall = bd.kind === "icebergs" ? new THREE.Color("#f7f7f2") : WALLS[Math.floor(rand(i) * WALLS.length)]!;
    // Floors: slightly darker bands every 3.1 m, like windows and balconies.
    const y = flat.getAttribute("position").getY(v);
    const band = ((y - bd.base) % 3.1) / 3.1;
    c.copy(wall).multiplyScalar(band > 0.45 && band < 0.75 && bd.kind !== "roof" ? 0.78 : 1);
    colours.set([c.r, c.g, c.b], v * 3);
  }
  // Roofs: colour by the building under each vertex (nearest footprint centroid).
  const centroids = course.buildings.map((bd) => {
    let x = 0;
    let z = 0;
    for (const [px, pz] of bd.footprint) {
      x += px;
      z += pz;
    }
    return [x / bd.footprint.length, z / bd.footprint.length] as const;
  });
  const p = flat.getAttribute("position");
  for (let k = wallVerts.length; k < count; k += 3) {
    const x = (p.getX(k) + p.getX(k + 1) + p.getX(k + 2)) / 3;
    const z = (p.getZ(k) + p.getZ(k + 1) + p.getZ(k + 2)) / 3;
    let best = 0;
    let bestD = Infinity;
    centroids.forEach(([cx, cz], i) => {
      const d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    c.copy(course.buildings[best]!.kind === "icebergs" ? new THREE.Color("#f0f0ea") : ROOFS[Math.floor(rand(best * 7.1) * ROOFS.length)]!);
    for (let q = 0; q < 3; q++) colours.set([c.r, c.g, c.b], (k + q) * 3);
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  flat.computeVertexNormals();
  const mesh = new THREE.Mesh(flat, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function poolsMesh(course: CourseData): THREE.Group {
  const group = new THREE.Group();
  for (const ring of course.pools) {
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geom = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    let y = Infinity;
    for (const [x, z] of ring) y = Math.min(y, heightAt(course.terrain, x, z));
    const mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ color: "#3fd0e0", emissive: "#0b5a66", emissiveIntensity: 0.25 }));
    mesh.position.y = Math.max(y, 0.4) + 0.15;
    group.add(mesh);
    // Lane ropes.
    const box = new THREE.Box3().setFromBufferAttribute(geom.getAttribute("position") as THREE.BufferAttribute);
    const lanes = Math.floor((box.max.x - box.min.x) / 2.5);
    for (let i = 1; i < lanes; i++) {
      const rope = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, (box.max.z - box.min.z) * 0.92), new THREE.MeshBasicMaterial({ color: i % 2 ? "#f4f4f4" : "#1f4fa0" }));
      rope.position.set(box.min.x + (i * (box.max.x - box.min.x)) / lanes, mesh.position.y + 0.03, (box.min.z + box.max.z) / 2);
      if (lanes > 2) group.add(rope);
    }
  }
  return group;
}

// ------------------------------------------------------------------ trees and props

/** Side of the tiles scattered things are grouped into (m), so whole tiles can be culled. */
const TILE = 300;

/**
 * Split `items` into square tiles by position. One instanced mesh for everything can't be
 * culled (its bounds are the whole map), so every tree would be drawn in every pass,
 * the shadow map's included; per-tile meshes let the camera and the sun skip most of them.
 */
function tiles<T>(items: T[], at: (item: T) => { x: number; z: number }): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const p = at(item);
    const key = `${Math.floor(p.x / TILE)},${Math.floor(p.z / TILE)}`;
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    list.push(item);
  }
  return [...map.values()];
}

function treesMesh(course: CourseData): THREE.Group {
  const group = new THREE.Group();
  const trees = course.trees;
  // Norfolk Island pines: tall, layered, dark. And rounder coastal trees (banksias, figs).
  const pineTrunk = new THREE.CylinderGeometry(0.18, 0.35, TREE_HEIGHT, 6).translate(0, TREE_HEIGHT / 2, 0);
  const tiers: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    const y = 3.2 + k * 1.35;
    const r = 2.3 - k * 0.32;
    tiers.push(new THREE.ConeGeometry(r, 1.6, 7).translate(0, y, 0));
  }
  const pineCrown = mergeGeometries(tiers)!;
  const roundTrunk = new THREE.CylinderGeometry(0.2, 0.3, 3.5, 6).translate(0, 1.75, 0);
  const roundCrown = new THREE.IcosahedronGeometry(2.6, 0).scale(1, 0.8, 1).translate(0, 4.6, 0);

  const pines = trees.filter((_, i) => rand(i * 3.3) < 0.55);
  const rounds = trees.filter((_, i) => rand(i * 3.3) >= 0.55);
  const materials = new Map<string, THREE.Material>();
  const place = (all: typeof trees, geom: THREE.BufferGeometry, colour: string, shadow: boolean) => {
    if (!materials.has(colour)) materials.set(colour, new THREE.MeshLambertMaterial({ color: colour }));
    for (const list of tiles(all, ([x, , z]) => ({ x, z }))) placeTile(list, geom, materials.get(colour)!, shadow);
  };
  const placeTile = (list: typeof trees, geom: THREE.BufferGeometry, material: THREE.Material, shadow: boolean) => {
    const mesh = new THREE.InstancedMesh(geom, material, list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    list.forEach(([x, y, z], i) => {
      const s = 0.8 + rand(x * 0.37 + z) * 0.45;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(x + z * 1.7) * Math.PI * 2);
      m.compose(new THREE.Vector3(x, y - 0.3, z), q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  place(pines, pineTrunk, "#6b4a33", true);
  place(pines, pineCrown, "#2f5a2e", true);
  place(rounds, roundTrunk, "#7a5a40", true);
  place(rounds, roundCrown, "#5d8a3a", true);
  return group;
}

/**
 * Coastal heath: low, rounded banksia and saltbush clumps scattered over the scrub
 * cells between the suburbs and the cliffs. Decoration only: you ski through them.
 */
function heathMesh(course: CourseData): THREE.Group {
  const t = course.terrain;
  const spots: [number, number, number, number][] = [];
  for (let r = 0; r < t.rows; r++) {
    for (let c = 0; c < t.cols; c++) {
      const i = r * t.cols + c;
      if (t.surface[i] !== Surface.scrub || rand(i * 3.7) > 0.55) continue;
      const x = t.x0 + (c + rand(i) - 0.5) * t.cell;
      const z = t.z0 + (r + rand(i * 1.3) - 0.5) * t.cell;
      spots.push([x, heightAt(t, x, z), z, 0.6 + rand(i * 2.1) * 0.9]);
    }
  }
  const geom = new THREE.IcosahedronGeometry(1, 0).scale(1.1, 0.6, 1.1).translate(0, 0.3, 0);
  const material = new THREE.MeshLambertMaterial({ color: "#ffffff" });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const greens = ["#5f7a3a", "#6f8646", "#4f6b35", "#7d8a4d", "#8a8f5a"].map((h) => new THREE.Color(h));
  const group = new THREE.Group();
  const numbered = spots.map((s, k) => [...s, k] as const);
  for (const list of tiles(numbered, ([x, , z]) => ({ x, z }))) {
    const mesh = new THREE.InstancedMesh(geom, material, list.length);
    list.forEach(([x, y, z, s, k], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand(k * 5.3) * Math.PI * 2);
      m.compose(new THREE.Vector3(x, y - 0.1, z), q, new THREE.Vector3(s, s * (0.7 + rand(k) * 0.6), s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.copy(greens[k % greens.length]!));
    });
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function propsMesh(course: CourseData): THREE.Group {
  const group = new THREE.Group();
  // Benches.
  const bench = mergeGeometries([
    new THREE.BoxGeometry(1.8, 0.08, 0.45).translate(0, 0.45, 0),
    new THREE.BoxGeometry(1.8, 0.4, 0.06).translate(0, 0.7, -0.22),
    new THREE.BoxGeometry(0.08, 0.45, 0.4).translate(-0.8, 0.22, 0),
    new THREE.BoxGeometry(0.08, 0.45, 0.4).translate(0.8, 0.22, 0),
  ])!;
  const benches = new THREE.InstancedMesh(bench, new THREE.MeshLambertMaterial({ color: "#8a6a4a" }), course.benches.length);
  const m = new THREE.Matrix4();
  course.benches.forEach(([x, y, z], i) => {
    m.makeRotationY(rand(x + z) * Math.PI * 2).setPosition(x, Math.max(y, heightAt(course.terrain, x, z)), z);
    benches.setMatrixAt(i, m);
  });
  group.add(benches);
  // Sculptures (the walk hosts Sculpture by the Sea each spring): bright abstract forms.
  const palette = ["#e5484d", "#f5a524", "#3e63dd", "#12a594", "#f0f0f0", "#8e4ec6"];
  course.sculptures.forEach(([x, y, z], i) => {
    const kind = Math.floor(rand(i * 5.1) * 3);
    const geom =
      kind === 0
        ? new THREE.TorusGeometry(1.4, 0.35, 8, 20)
        : kind === 1
          ? new THREE.OctahedronGeometry(1.5, 0)
          : new THREE.CylinderGeometry(0.2, 0.9, 3.4, 5);
    const mesh = new THREE.Mesh(geom, new THREE.MeshLambertMaterial({ color: palette[i % palette.length] }));
    mesh.position.set(x, Math.max(y, heightAt(course.terrain, x, z)) + 1.8, z);
    mesh.rotation.set(rand(i) * 0.6, rand(i * 2) * Math.PI, rand(i * 3) * 0.6);
    mesh.castShadow = true;
    group.add(mesh);
  });
  return group;
}

/** Galvanised cliff-top railings: a post at each joint, a top rail and a mid rail. */
function railsMesh(route: Route): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const bar = (a: THREE.Vector3, b: THREE.Vector3, thick: number) => {
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(thick, thick, len);
    g.lookAt(new THREE.Vector3().subVectors(b, a));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(g);
  };
  for (const { a, b } of route.rails) {
    const pa = new THREE.Vector3(a.x, a.y, a.z);
    const pb = new THREE.Vector3(b.x, b.y, b.z);
    bar(pa, pa.clone().setY(a.y + RAIL_HEIGHT), 0.07);
    bar(pa.clone().setY(a.y + RAIL_HEIGHT), pb.clone().setY(b.y + RAIL_HEIGHT), 0.05);
    bar(pa.clone().setY(a.y + RAIL_HEIGHT * 0.5), pb.clone().setY(b.y + RAIL_HEIGHT * 0.5), 0.04);
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed()))!, new THREE.MeshLambertMaterial({ color: "#c9ced2" }));
  mesh.castShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ gates

/**
 * An arch over the walk: two posts, a banner, a glowing portal you have to pass through,
 * and a tall beam of light over the next gate so you can find it from anywhere.
 */
function gateView(course: CourseData, route: Route, index: number, name: string): GateView {
  const a = route.gates[index]!.arch;
  const W = a.halfWidth;
  const root = new THREE.Group();
  const yaw = Math.atan2(-a.tx, -a.tz);
  const postMat = new THREE.MeshLambertMaterial({ color: "#f4f1ea" });
  const glowMat = new THREE.MeshBasicMaterial({
    color: "#ffd84a",
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  for (const side of [-1, 1]) {
    const x = a.x + a.rx * W * side;
    const z = a.z + a.rz * W * side;
    const ground = heightAt(course.terrain, x, z) - 1;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, a.top - ground, 0.6), postMat);
    post.position.set(x, (a.top + ground) / 2, z);
    post.castShadow = true;
    root.add(post);
  }
  const portalBottom = a.bottom + 3;
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, a.top - portalBottom), glowMat);
  portal.position.set(a.x, (a.top + portalBottom) / 2, a.z);
  portal.rotation.y = yaw;
  root.add(portal);
  const label = index === 0 ? "START" : index === route.gates.length - 1 ? `FINISH · ${name}` : `${index} · ${name}`;
  const banner = textPlane(label, W * 2 + 0.6, 2);
  banner.position.set(a.x, a.top + 1, a.z);
  banner.rotation.y = yaw;
  root.add(banner);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, 160, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: "#ff9f1a", transparent: true, opacity: 0.45, depthWrite: false, fog: false }),
  );
  beam.position.set(a.x, a.top + 80, a.z);
  root.add(beam);
  return {
    root,
    setState(state) {
      glowMat.color.set(state === "next" ? "#ffd84a" : state === "passed" ? "#3ddc84" : "#9ecbff");
      glowMat.opacity = state === "next" ? 0.22 : 0.08;
      beam.visible = state === "next";
    },
  };
}

function textPlane(text: string, width: number, height: number): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = Math.round((1024 * height) / width);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1f5fb0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${Math.round(canvas.height * 0.55)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.toUpperCase(), canvas.width / 2, canvas.height / 2 + 2, canvas.width - 40);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, fog: true }));
}
