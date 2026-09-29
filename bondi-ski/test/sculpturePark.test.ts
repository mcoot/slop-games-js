import { describe, expect, it } from "vitest";
import { RAPIER } from "@slop/physics";
import { heightAt, inSea, Surface, surfaceAt } from "../src/course/data";
import { mapById } from "../src/maps";
import { DT, makeCourse, readCourse } from "./harness";

const map = mapById("sculpture-park");

describe("Sculpture Park (built in Blender)", () => {
  it("replaces the ground inside the wall with dry land and leaves the coast round it alone", async () => {
    const real = readCourse();
    const { course } = await makeCourse(map);
    const t = course.terrain;
    const { x, z } = map.centre;
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      for (const f of [0, 0.3, 0.6, 0.95]) {
        const px = x + Math.cos(a) * map.radius * f;
        const pz = z + Math.sin(a) * map.radius * f;
        expect(heightAt(t, px, pz)).toBeGreaterThan(10);
        expect(surfaceAt(t, px, pz)).not.toBe(Surface.sea);
      }
    }
    // Well outside, it's the real coast: Bondi Beach is still sand at the waterline.
    expect(heightAt(t, 280, -660)).toBeCloseTo(heightAt(real.terrain, 280, -660), 5);
    // The real park's buildings and trees are gone from inside; the map's pines are there.
    for (const b of course.buildings) for (const [bx, bz] of b.footprint) expect(Math.hypot(bx - x, bz - z)).toBeGreaterThan(map.radius);
    expect(course.trees.filter(([tx, , tz]) => Math.hypot(tx - x, tz - z) < map.radius).length).toBeGreaterThan(8);
  });

  it("is the same turned half a circle round the middle, so neither end is favoured", async () => {
    const { course } = await makeCourse(map);
    const t = course.terrain;
    for (let i = 0; i < 200; i++) {
      const a = i * 2.39996;
      const r = Math.sqrt(i / 200) * (map.radius - 5);
      const u = Math.cos(a) * r;
      const v = Math.sin(a) * r;
      expect(heightAt(t, map.centre.x + u, map.centre.z + v)).toBeCloseTo(heightAt(t, map.centre.x - u, map.centre.z - v), 1);
    }
  });

  it("has spawns at both ends and in the middle, standing clear of every structure", async () => {
    const { world, arenaSpawns, course } = await makeCourse(map);
    const spawns = arenaSpawns!;
    expect(spawns.length).toBeGreaterThanOrEqual(16);
    const north = spawns.filter((s) => s.z < map.centre.z - 60).length;
    const south = spawns.filter((s) => s.z > map.centre.z + 60).length;
    expect(north).toBe(south);
    expect(north).toBeGreaterThanOrEqual(4);
    const hull = new RAPIER.Capsule(0.6, 0.4);
    for (const s of spawns) {
      expect(inSea(course.terrain, s)).toBe(false);
      // A standing player's hull there touches nothing.
      let blocked = false;
      world.intersectionsWithShape({ x: s.x, y: s.y + 1.1, z: s.z }, { x: 0, y: 0, z: 0, w: 1 }, hull, () => ((blocked = true), false));
      expect(blocked, `spawn at ${s.x.toFixed(0)},${s.y.toFixed(0)},${s.z.toFixed(0)}`).toBe(false);
    }
  });

  it("the compound walls are solid and the gate is open", async () => {
    const { player, step, course } = await makeCourse(map);
    const t = course.terrain;
    // From the middle of the north compound, run south through the gate: out into the valley.
    const gx = map.centre.x;
    const gz = map.centre.z - 80;
    player.teleport({ x: gx, y: heightAt(t, gx, gz) + 0.5, z: gz });
    for (let i = 0; i < 4 / DT; i++) step({ forward: 1, yaw: Math.PI });
    expect(player.feet.z).toBeGreaterThan(map.centre.z - 60);
    // Two metres west of the gate, the front wall stops you.
    const wx = map.centre.x - 9;
    player.teleport({ x: wx, y: heightAt(t, wx, gz) + 0.5, z: gz });
    for (let i = 0; i < 4 / DT; i++) step({ forward: 1, yaw: Math.PI });
    expect(player.feet.z).toBeLessThan(map.centre.z - 68);
  });
});
