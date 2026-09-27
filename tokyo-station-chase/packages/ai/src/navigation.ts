import * as THREE from "three";
import { init as initRecast, NavMeshQuery, type NavMesh } from "@recast-navigation/core";
import { generateSoloNavMesh } from "@recast-navigation/generators";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The walker the navmesh is built for. Match the character controller so paths are ones it can actually walk. */
export interface NavAgent {
  /** Hull half-width (m). */
  radius: number;
  /** Standing height (m). */
  height: number;
  /** Tallest step it walks up (m). */
  stepHeight: number;
  /** Steepest walkable slope (degrees). */
  maxSlopeDeg: number;
}

/** Voxel size (m). Smaller is more precise and slower to build. */
const CELL = 0.2;
const CELL_HEIGHT = 0.1;
/** How far from the navmesh a query position may be (m). */
const SEARCH_EXTENTS = { x: 2, y: 3, z: 2 };

let ready: Promise<void> | null = null;

/** Load the Recast WASM module once. Safe to call repeatedly. */
export function initNavigation(): Promise<void> {
  ready ??= initRecast();
  return ready;
}

/**
 * A navmesh for one level, built from its collision meshes, plus the queries
 * the chaser needs. Positions are feet positions (on the ground).
 */
export class Navigation {
  private constructor(
    private readonly navMesh: NavMesh,
    private readonly query: NavMeshQuery,
  ) {}

  /** Build from world-space meshes. Call `initNavigation()` first. */
  static build(meshes: THREE.Mesh[], agent: NavAgent): Navigation {
    const { positions, indices } = mergeGeometry(meshes);
    const result = generateSoloNavMesh(positions, indices, {
      cs: CELL,
      ch: CELL_HEIGHT,
      walkableSlopeAngle: agent.maxSlopeDeg,
      walkableHeight: Math.ceil(agent.height / CELL_HEIGHT),
      walkableClimb: Math.floor(agent.stepHeight / CELL_HEIGHT),
      walkableRadius: Math.ceil(agent.radius / CELL),
      maxEdgeLen: 12 / CELL,
      maxSimplificationError: 1.3,
      minRegionArea: 8,
      mergeRegionArea: 20,
      maxVertsPerPoly: 6,
      detailSampleDist: 6 * CELL,
      detailSampleMaxError: CELL_HEIGHT,
    });
    if (!result.success) throw new Error(`navmesh build failed: ${result.error}`);
    return new Navigation(result.navMesh, new NavMeshQuery(result.navMesh, { maxNodes: 4096 }));
  }

  /** For debug drawing (e.g. @recast-navigation/three's NavMeshHelper). */
  get mesh(): NavMesh {
    return this.navMesh;
  }

  /** Nearest point on the navmesh, or null if nothing is close. */
  closestPoint(p: Vec3): Vec3 | null {
    const r = this.query.findClosestPoint(p, { halfExtents: SEARCH_EXTENTS });
    return r.success && r.polyRef !== 0 ? { ...r.point } : null;
  }

  /**
   * Corner points of the shortest path, including start and end. If `to` can't be
   * reached the path ends at the reachable point closest to it. Empty if `from` is off the mesh.
   */
  path(from: Vec3, to: Vec3): Vec3[] {
    const r = this.query.computePath(from, to, { halfExtents: SEARCH_EXTENTS, maxPathPolys: 1024 });
    return r.success ? r.path.map((p) => ({ x: p.x, y: p.y, z: p.z })) : [];
  }

  /** Length of the path between two points (m), or Infinity if there's no path. */
  pathLength(from: Vec3, to: Vec3): number {
    const path = this.path(from, to);
    if (path.length === 0) return Infinity;
    let length = 0;
    for (let i = 1; i < path.length; i++) length += dist(path[i - 1]!, path[i]!);
    return length;
  }

  /**
   * A point on the navmesh within `radius` of `center` (horizontally), chosen with
   * `random` so tests can be deterministic. Null if no sample landed on the mesh.
   */
  randomPointNear(center: Vec3, radius: number, random: () => number, attempts = 12): Vec3 | null {
    for (let i = 0; i < attempts; i++) {
      const angle = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * radius;
      const p = this.closestPoint({ x: center.x + Math.cos(angle) * r, y: center.y, z: center.z + Math.sin(angle) * r });
      if (p && Math.hypot(p.x - center.x, p.z - center.z) <= radius + 0.5) return p;
    }
    return null;
  }

  dispose(): void {
    this.query.destroy();
    this.navMesh.destroy();
  }
}

export function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function mergeGeometry(meshes: THREE.Mesh[]): { positions: Float32Array; indices: Uint32Array } {
  const positions: number[] = [];
  const indices: number[] = [];
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const geom = mesh.geometry as THREE.BufferGeometry;
    const pos = geom.getAttribute("position");
    if (!pos) continue;
    const base = positions.length / 3;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      positions.push(v.x, v.y, v.z);
    }
    if (geom.index) for (let i = 0; i < geom.index.count; i++) indices.push(base + geom.index.getX(i));
    else for (let i = 0; i < pos.count; i++) indices.push(base + i);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}
