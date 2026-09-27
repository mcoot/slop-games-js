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
 * - Meshes named `*_col` only collide: they're hidden. Use them for simplified
 *   collision under detailed art.
 * - Meshes named `*_col_trigger` are hidden sensor volumes. They never block the
 *   player; ask `triggersAt` which ones contain a point.
 * - Empties with a `type` custom property are markers (`player_spawn`, and later
 *   chaser spawns, pickups, interaction points...). An empty's forward axis (-Z in
 *   three.js, +Y in Blender) is its facing.
 *
 * Blender's duplicate suffixes (`.001`) are ignored, so `pillar_col.001` still counts.
 * Any other custom properties (e.g. `surface`) are left in `userData` for the game.
 */
export const COLLISION_SUFFIX = "_col";
export const TRIGGER_SUFFIX = "_col_trigger";
export const PLAYER_SPAWN = "player_spawn";

export interface LevelTrigger {
  /** Object name without the `_col_trigger` suffix. */
  name: string;
  object: THREE.Mesh;
  collider: RAPIER.Collider;
}

export interface LevelMarker {
  /** Object name as authored in Blender. */
  name: string;
  /** The `type` custom property. */
  type: string;
  position: { x: number; y: number; z: number };
  /** Facing as a yaw, same convention as the FPS controller: 0 looks down -Z, positive turns left. */
  yaw: number;
  object: THREE.Object3D;
}

export interface Level {
  /** Everything from the file. Collision-only and trigger meshes are hidden. */
  root: THREE.Object3D;
  /** The first `player_spawn` marker, or the origin facing -Z if there is none. */
  spawn: { position: { x: number; y: number; z: number }; yaw: number };
  /** Markers grouped by their `type`. */
  markers: Map<string, LevelMarker[]>;
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
  const markers = new Map<string, LevelMarker[]>();

  root.traverse((obj) => {
    const name = authoredName(obj);
    const type = obj.userData.type;
    if (typeof type === "string" && !(obj instanceof THREE.Mesh)) {
      const marker = markerFrom(obj, name, type);
      markers.set(type, [...(markers.get(type) ?? []), marker]);
      return;
    }
    if (!(obj instanceof THREE.Mesh)) return;

    if (name.endsWith(TRIGGER_SUFFIX)) {
      obj.visible = false;
      // Sensors need a solid shape to contain points, so non-box triggers use their convex hull.
      const desc = colliderKind(obj) === "box" ? colliderDescForMesh(obj, "box") : convexHullDesc(obj);
      if (!desc) return;
      const collider = world.createCollider(desc.setSensor(true));
      triggers.push({ name: name.slice(0, -TRIGGER_SUFFIX.length), object: obj, collider });
      return;
    }

    if (name.endsWith(COLLISION_SUFFIX)) obj.visible = false;
    const desc = colliderDescForMesh(obj);
    if (desc) colliders.push(world.createCollider(desc));
  });

  const spawn = markers.get(PLAYER_SPAWN)?.[0];
  return {
    root,
    spawn: spawn ? { position: spawn.position, yaw: spawn.yaw } : { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
    markers,
    colliders,
    triggers,
  };
}

/** Remove a level's colliders from `world` and free its geometry. Materials are left alone (they may be shared). */
export function disposeLevel(world: PhysicsWorld, level: Level): void {
  for (const c of level.colliders) world.removeCollider(c, false);
  for (const t of level.triggers) world.removeCollider(t.collider, false);
  level.colliders.length = 0;
  level.triggers.length = 0;
  level.root.removeFromParent();
  level.root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry.dispose();
  });
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

/**
 * The object's name as authored, without Blender's `.001` duplicate suffix. three.js
 * strips dots from `obj.name`, but GLTFLoader keeps the original in `userData.name`.
 */
function authoredName(obj: THREE.Object3D): string {
  const name = typeof obj.userData.name === "string" ? obj.userData.name : obj.name;
  return name.replace(/\.\d{3,}$/, "");
}

function markerFrom(obj: THREE.Object3D, name: string, type: string): LevelMarker {
  const p = obj.getWorldPosition(new THREE.Vector3());
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(obj.getWorldQuaternion(new THREE.Quaternion()));
  return { name, type, position: { x: p.x, y: p.y, z: p.z }, yaw: Math.atan2(-forward.x, -forward.z), object: obj };
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
