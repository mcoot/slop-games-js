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

/**
 * Create fixed colliders for every mesh under `root`, using world transforms.
 * Box geometries become cuboids (cheap and exact); anything else becomes a trimesh.
 * Meshes with `userData.collision === false` are skipped.
 */
export function addStaticColliders(world: RAPIER.World, root: THREE.Object3D): RAPIER.Collider[] {
  root.updateWorldMatrix(true, true);
  const created: RAPIER.Collider[] = [];
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || obj.userData.collision === false) return;
    const collider = colliderForMesh(world, obj);
    if (collider) created.push(collider);
  });
  return created;
}

export function colliderForMesh(world: RAPIER.World, mesh: THREE.Mesh): RAPIER.Collider | null {
  mesh.matrixWorld.decompose(_pos, _quat, _scale);
  const geom = mesh.geometry as THREE.BufferGeometry;

  if (geom instanceof THREE.BoxGeometry) {
    const p = geom.parameters;
    const desc = RAPIER.ColliderDesc.cuboid(
      (p.width / 2) * Math.abs(_scale.x),
      (p.height / 2) * Math.abs(_scale.y),
      (p.depth / 2) * Math.abs(_scale.z),
    )
      .setTranslation(_pos.x, _pos.y, _pos.z)
      .setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w });
    return world.createCollider(desc);
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
  return world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices));
}
