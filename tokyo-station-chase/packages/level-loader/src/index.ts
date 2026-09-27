import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RAPIER, colliderDescForMesh, colliderKind, type PhysicsWorld } from "@slop/physics";

/**
 * Levels are authored in Blender and exported to glTF (.glb). Object names and
 * custom properties (glTF "extras", which three.js puts in `userData`) say what
 * each object is for:
 *
 * - Plain meshes are drawn and collide. Box-shaped meshes get exact cuboid colliders,
 *   everything else a triangle mesh. The `collider` property ("box" | "mesh" | "none")
 *   overrides that.
 * - `COL_*` meshes only collide: they're hidden. Use them for simplified collision
 *   under detailed art.
 * - `TRIG_*` meshes are hidden sensor volumes. They never block the player; ask
 *   `triggersAt` which ones contain a point.
 * - `SPAWN_player` is an empty at the player's feet. Its forward axis (-Z in three.js,
 *   +Y in Blender) is the direction the player starts facing.
 *
 * Any other custom properties (e.g. `surface`) are left in `userData` for the game.
 */
export const COLLISION_PREFIX = "COL_";
export const TRIGGER_PREFIX = "TRIG_";
export const SPAWN_NAME = "SPAWN_player";

export interface LevelTrigger {
  /** Object name without the `TRIG_` prefix. */
  name: string;
  object: THREE.Mesh;
  collider: RAPIER.Collider;
}

export interface Level {
  /** Everything from the file. Collision-only and trigger meshes are hidden. */
  root: THREE.Object3D;
  spawn: { position: { x: number; y: number; z: number }; yaw: number };
  /** Solid colliders created for the level. */
  colliders: RAPIER.Collider[];
  triggers: LevelTrigger[];
}

/** Load a .glb from a URL (browser) or from its bytes (tests, tools), and add its physics to `world`. */
export async function loadLevel(world: PhysicsWorld, source: string | ArrayBuffer): Promise<Level> {
  const loader = new GLTFLoader();
  const gltf = typeof source === "string" ? await loader.loadAsync(source) : await loader.parseAsync(source, "");
  return buildLevel(world, gltf.scene);
}

/** Interpret an already loaded scene graph as a level and add its physics to `world`. */
export function buildLevel(world: PhysicsWorld, root: THREE.Object3D): Level {
  root.updateWorldMatrix(true, true);
  const colliders: RAPIER.Collider[] = [];
  const triggers: LevelTrigger[] = [];
  let spawnObject: THREE.Object3D | null = null;

  root.traverse((obj) => {
    if (obj.name === SPAWN_NAME) spawnObject = obj;
    if (!(obj instanceof THREE.Mesh)) return;

    if (obj.name.startsWith(TRIGGER_PREFIX)) {
      obj.visible = false;
      // Sensors need a solid shape to contain points, so non-box triggers use their convex hull.
      const kind = colliderKind(obj);
      const desc = kind === "box" ? colliderDescForMesh(obj, "box") : convexHullDesc(obj);
      if (!desc) return;
      const collider = world.createCollider(desc.setSensor(true));
      triggers.push({ name: obj.name.slice(TRIGGER_PREFIX.length), object: obj, collider });
      return;
    }

    if (obj.name.startsWith(COLLISION_PREFIX)) obj.visible = false;
    const desc = colliderDescForMesh(obj);
    if (desc) colliders.push(world.createCollider(desc));
  });

  return { root, spawn: spawnFrom(spawnObject), colliders, triggers };
}

/** Names of the triggers containing `point`. Like all Rapier queries, sees colliders as of the last `world.step()`. */
export function triggersAt(world: PhysicsWorld, level: Level, point: { x: number; y: number; z: number }): string[] {
  const names: string[] = [];
  world.intersectionsWithPoint(
    point,
    (collider) => {
      const trigger = level.triggers.find((t) => t.collider.handle === collider.handle);
      if (trigger) names.push(trigger.name);
      return true;
    },
    RAPIER.QueryFilterFlags.EXCLUDE_SOLIDS,
  );
  return names;
}

function spawnFrom(obj: THREE.Object3D | null): Level["spawn"] {
  if (!obj) return { position: { x: 0, y: 0, z: 0 }, yaw: 0 };
  const p = obj.getWorldPosition(new THREE.Vector3());
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(obj.getWorldQuaternion(new THREE.Quaternion()));
  // Same convention as the FPS controller: yaw 0 looks down -Z, positive turns left.
  const yaw = Math.atan2(-forward.x, -forward.z);
  return { position: { x: p.x, y: p.y, z: p.z }, yaw };
}

function convexHullDesc(mesh: THREE.Mesh): RAPIER.ColliderDesc | null {
  const position = mesh.geometry.getAttribute("position");
  if (!position) return null;
  const points = new Float32Array(position.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    points.set([v.x, v.y, v.z], i * 3);
  }
  return RAPIER.ColliderDesc.convexHull(points);
}
