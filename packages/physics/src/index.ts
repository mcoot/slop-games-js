import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

export { RAPIER };
export type PhysicsWorld = RAPIER.World;

let ready: Promise<void> | null = null;

/** Load the Rapier WASM module once. Safe to call repeatedly. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export async function createPhysicsWorld(gravityY = -9.81): Promise<RAPIER.World> {
  await initPhysics();
  return new RAPIER.World({ x: 0, y: gravityY, z: 0 });
}

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

/** How a mesh collides: its exact box, its triangles, or not at all. */
export type ColliderKind = "box" | "mesh" | "none";

/**
 * Create fixed colliders for every mesh under `root`, using world transforms.
 * Box-shaped meshes become cuboids (cheap and exact); anything else becomes a trimesh.
 * `userData.collider` ("box" | "mesh" | "none") overrides the choice, and meshes with
 * `userData.collision === false` are skipped.
 */
export function addStaticColliders(world: RAPIER.World, root: THREE.Object3D): RAPIER.Collider[] {
  root.updateWorldMatrix(true, true);
  const created: RAPIER.Collider[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const collider = colliderForMesh(world, obj);
    if (collider) created.push(collider);
  });
  return created;
}

export function colliderForMesh(world: RAPIER.World, mesh: THREE.Mesh): RAPIER.Collider | null {
  const desc = colliderDescForMesh(mesh);
  return desc ? world.createCollider(desc) : null;
}

/** Which collider a mesh gets, from `userData` or its shape. */
export function colliderKind(mesh: THREE.Mesh): ColliderKind {
  const override = mesh.userData.collider;
  if (override === "box" || override === "mesh" || override === "none") return override;
  if (mesh.userData.collision === false) return "none";
  return localBox(mesh.geometry) ? "box" : "mesh";
}

/**
 * Collider description for a mesh in world space, or null if it doesn't collide.
 * Expects `mesh.matrixWorld` to be up to date.
 */
export function colliderDescForMesh(mesh: THREE.Mesh, kind = colliderKind(mesh)): RAPIER.ColliderDesc | null {
  if (kind === "none") return null;
  mesh.matrixWorld.decompose(_pos, _quat, _scale);
  const geom = mesh.geometry as THREE.BufferGeometry;

  if (kind === "box") {
    geom.computeBoundingBox();
    const box = localBox(geom) ?? geom.boundingBox!;
    const center = box.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    const size = box.getSize(new THREE.Vector3());
    return RAPIER.ColliderDesc.cuboid(
      (size.x / 2) * Math.abs(_scale.x),
      (size.y / 2) * Math.abs(_scale.y),
      (size.z / 2) * Math.abs(_scale.z),
    )
      .setTranslation(center.x, center.y, center.z)
      .setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w });
  }

  const position = geom.getAttribute("position");
  if (!position) return null;
  const vertices = new Float32Array(position.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    vertices.set([v.x, v.y, v.z], i * 3);
  }
  let indices: Uint32Array;
  if (geom.index) {
    indices = Uint32Array.from(geom.index.array);
  } else {
    indices = new Uint32Array(position.count);
    for (let i = 0; i < indices.length; i++) indices[i] = i;
  }
  return RAPIER.ColliderDesc.trimesh(vertices, indices);
}

/**
 * The geometry's bounds if it is exactly an axis-aligned box in its own space: every
 * vertex sits on a corner and all eight corners are used. BoxGeometry always is;
 * a cube exported from Blender is too, even after its faces are split for flat normals.
 */
export function localBox(geom: THREE.BufferGeometry): THREE.Box3 | null {
  const position = geom.getAttribute("position");
  if (!position || position.count < 8) return null;
  geom.computeBoundingBox();
  const b = geom.boundingBox!;
  const size = b.getSize(new THREE.Vector3());
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) return null;
  const eps = 1e-5 * Math.max(size.x, size.y, size.z, 1);
  const side = (value: number, min: number, max: number) =>
    Math.abs(value - min) <= eps ? 0 : Math.abs(value - max) <= eps ? 1 : -1;
  let corners = 0;
  for (let i = 0; i < position.count; i++) {
    const sx = side(position.getX(i), b.min.x, b.max.x);
    const sy = side(position.getY(i), b.min.y, b.max.y);
    const sz = side(position.getZ(i), b.min.z, b.max.z);
    if (sx < 0 || sy < 0 || sz < 0) return null;
    corners |= 1 << (sx | (sy << 1) | (sz << 2));
  }
  return corners === 0xff ? b.clone() : null;
}
