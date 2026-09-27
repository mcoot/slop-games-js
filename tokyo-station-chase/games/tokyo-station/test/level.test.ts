import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { colliderKind, createPhysicsWorld, localBox } from "@slop/physics";
import { buildLevel, loadLevel, triggersAt } from "@slop/level-loader";
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
  it("hides COL_ and TRIG_ meshes, makes triggers sensors, and reads spawn facing", async () => {
    const world = await createPhysicsWorld();
    const root = new THREE.Group();
    const add = (name: string, x: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
      m.name = name;
      m.position.x = x;
      root.add(m);
      return m;
    };
    const art = add("art", 0);
    art.userData.collider = "none";
    const col = add("COL_art", 0);
    const trig = add("TRIG_zone", 10);
    const spawn = new THREE.Object3D();
    spawn.name = "SPAWN_player";
    spawn.position.set(1, 2, 3);
    spawn.rotation.y = Math.PI / 2; // facing -X: a quarter turn left
    root.add(spawn);

    const level = buildLevel(world, root);
    world.step(); // queries see new colliders after a step
    expect(art.visible).toBe(true);
    expect(col.visible).toBe(false);
    expect(trig.visible).toBe(false);
    expect(level.colliders).toHaveLength(1);
    expect(level.triggers.map((t) => t.name)).toEqual(["zone"]);
    expect(level.triggers[0]!.collider.isSensor()).toBe(true);
    expect(level.spawn.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(level.spawn.yaw).toBeCloseTo(Math.PI / 2);
    expect(triggersAt(world, level, { x: 10, y: 0, z: 0 })).toEqual(["zone"]);
    expect(triggersAt(world, level, { x: 0, y: 0, z: 0 })).toEqual([]);
  });
});

describe("Blender movement sandbox", () => {
  it("gives every piece of level geometry an exact box collider", async () => {
    const world = await createPhysicsWorld();
    const level = await loadLevel(world, readGlb());
    const meshes: THREE.Mesh[] = [];
    level.root.traverse((o) => o instanceof THREE.Mesh && !o.name.startsWith("TRIG_") && meshes.push(o));
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
