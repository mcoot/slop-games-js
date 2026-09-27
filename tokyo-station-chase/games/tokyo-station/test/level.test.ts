import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { colliderKind, createPhysicsWorld, localBox } from "@slop/physics";
import { buildLevel, disposeLevel, loadLevel, triggersAt } from "@slop/level-loader";
import { makeSandbox, readGlb } from "./harness";

describe("box collider detection", () => {
  it("treats box-shaped geometry as a box, whatever its vertex layout", () => {
    expect(localBox(new THREE.BoxGeometry(1, 2, 3))).not.toBeNull();
    expect(localBox(new THREE.BoxGeometry(1, 2, 3).toNonIndexed())).not.toBeNull();
    expect(localBox(new THREE.BoxGeometry(1, 2, 3).translate(5, 0, 0))).not.toBeNull();
  });

  it("uses a triangle mesh for anything else", () => {
    expect(localBox(new THREE.SphereGeometry(1))).toBeNull();
    expect(localBox(new THREE.CylinderGeometry(1, 1, 1, 4))).toBeNull();
    expect(localBox(new THREE.PlaneGeometry(1, 1))).toBeNull();
  });

  it("lets userData override the choice", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry());
    expect(colliderKind(mesh)).toBe("box");
    mesh.userData.collider = "mesh";
    expect(colliderKind(mesh)).toBe("mesh");
    mesh.userData = { collision: false };
    expect(colliderKind(mesh)).toBe("none");
  });
});

describe("level conventions", () => {
  async function conventionLevel() {
    const world = await createPhysicsWorld();
    const root = new THREE.Group();
    const add = (name: string, x: number, authored = name) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
      m.name = THREE.PropertyBinding.sanitizeNodeName(authored);
      if (authored !== m.name) m.userData.name = authored; // what GLTFLoader does
      m.position.x = x;
      root.add(m);
      return m;
    };
    const marker = (name: string, type: string, x: number, yawDeg = 0) => {
      const o = new THREE.Object3D();
      o.name = name;
      o.userData.type = type;
      o.position.set(x, 2, 3);
      o.rotation.y = THREE.MathUtils.degToRad(yawDeg);
      root.add(o);
      return o;
    };
    const art = add("art", 0);
    art.userData.collider = "none";
    const col = add("art_col", 0);
    const dup = add("art_col001", 20, "art_col.001");
    const trig = add("zone_col_trigger", 10);
    marker("player_spawn", "player_spawn", 1, 90); // facing -X: a quarter turn left
    marker("coin-a", "money_spawn", 5);
    marker("coin-b", "money_spawn", 6);
    const level = buildLevel(world, root);
    world.step(); // queries see new colliders after a step
    return { world, level, art, col, dup, trig };
  }

  it("hides _col and _col_trigger meshes and makes triggers sensors", async () => {
    const { world, level, art, col, dup, trig } = await conventionLevel();
    expect(art.visible).toBe(true);
    expect(col.visible).toBe(false);
    expect(dup.visible).toBe(false); // Blender's .001 suffix doesn't hide the convention
    expect(trig.visible).toBe(false);
    expect(level.colliders).toHaveLength(2);
    expect(level.triggers.map((t) => t.name)).toEqual(["zone"]);
    expect(level.triggers[0]!.collider.isSensor()).toBe(true);
    expect(triggersAt(world, level, { x: 10, y: 0, z: 0 })).toEqual(["zone"]);
    expect(triggersAt(world, level, { x: 0, y: 0, z: 0 })).toEqual([]);
  });

  it("groups markers by type and takes the spawn from player_spawn", async () => {
    const { level } = await conventionLevel();
    expect([...level.markers.keys()].sort()).toEqual(["money_spawn", "player_spawn"]);
    expect(level.markers.get("money_spawn")!.map((m) => m.name)).toEqual(["coin-a", "coin-b"]);
    expect(level.spawn.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(level.spawn.yaw).toBeCloseTo(Math.PI / 2);
  });

  it("removes every collider when disposed", async () => {
    const { world, level } = await conventionLevel();
    expect(world.colliders.len()).toBe(3);
    disposeLevel(world, level);
    expect(world.colliders.len()).toBe(0);
    expect(level.root.parent).toBeNull();
  });
});

describe("Blender movement sandbox", () => {
  it("gives every piece of level geometry an exact box collider", async () => {
    const world = await createPhysicsWorld();
    const level = await loadLevel(world, readGlb());
    const meshes: THREE.Mesh[] = [];
    const triggers = new Set(level.triggers.map((t) => t.object));
    level.root.traverse((o) => o instanceof THREE.Mesh && !triggers.has(o) && meshes.push(o));
    expect(meshes.length).toBeGreaterThan(50);
    expect(level.colliders).toHaveLength(meshes.length);
    for (const m of meshes) {
      expect(colliderKind(m), m.name).toBe("box");
      expect(m.userData.surface, m.name).toBeTypeOf("string");
    }
  });

  it("has the spawn, labels and stairs trigger", async () => {
    const world = await createPhysicsWorld();
    const level = await loadLevel(world, readGlb());
    expect(level.spawn.position.x).toBeCloseTo(0, 4);
    expect(level.spawn.position.y).toBeCloseTo(0.05, 4);
    expect(level.spawn.position.z).toBeCloseTo(10, 4);
    expect(level.spawn.yaw).toBeCloseTo(0, 5);
    const labels: string[] = [];
    level.root.traverse((o) => typeof o.userData.label === "string" && labels.push(o.userData.label));
    expect(labels).toContain("Stairs 17 cm");
    expect(labels).toContain("Crouch tunnel");
    expect([...level.markers.keys()].sort()).toEqual(["chaser_spawn", "chokepoint", "player_spawn"]);
    expect(Math.abs(level.markers.get("chaser_spawn")![0]!.yaw)).toBeCloseTo(Math.PI, 4); // facing back towards the player (±π)
    expect(level.markers.get("chokepoint")!.length).toBeGreaterThanOrEqual(3);
    expect(level.triggers.map((t) => t.name)).toEqual(["stairs-top"]);
  });

  it("reports the stairs-top trigger once the player climbs the stairs", async () => {
    const { world, level, player, run } = await makeSandbox({ x: -20, y: 0.011, z: -6 });
    const zone = () => triggersAt(world, level, { x: player.feet.x, y: player.feet.y + 0.9, z: player.feet.z });
    expect(zone()).toEqual([]);
    run(3.2, { forward: 1 });
    expect(zone()).toEqual(["stairs-top"]);
  });
});
