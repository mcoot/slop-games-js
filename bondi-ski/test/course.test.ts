import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { heightAt, inSea } from "../src/course/data";
import { buildRoute } from "../src/course/route";
import { buildingGeometry } from "../src/course/physics";
import { RaceTracker } from "../src/race/race";
import { DT, makeCourse, readCourse } from "./harness";
import { skiBot } from "./bot";

describe("course data", () => {
  const course = readCourse();
  it("follows the walk from Icebergs to Tamarama", () => {
    expect(course.checkpoints.map((c) => c.name)).toEqual([
      "Bondi Icebergs",
      "Marks Park",
      "Mackenzies Point",
      "Mackenzies Bay",
      "Tamarama Beach",
    ]);
    expect(course.length).toBeGreaterThan(900);
    expect(course.length).toBeLessThan(1300);
  });
  it("has the sea east of Mackenzies Point and Marks Park on a headland", () => {
    expect(heightAt(course.terrain, 400, 200)).toBeLessThan(-3);
    const [x, , z] = course.path[course.checkpoints[1]!.index]!;
    expect(heightAt(course.terrain, x, z)).toBeGreaterThan(15);
  });
  it("gives buildings upward roofs", () => {
    const { positions, indices, roofStart } = buildingGeometry(course);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    let down = 0;
    for (let k = roofStart; k < indices.length; k += 3) {
      a.fromArray(positions, indices[k]! * 3);
      b.fromArray(positions, indices[k + 1]! * 3);
      c.fromArray(positions, indices[k + 2]! * 3);
      // Skip slivers: a few footprints have collinear points.
      if (b.clone().sub(a).cross(c.clone().sub(a)).y < -1e-3) down++;
    }
    expect(down).toBe(0);
  });
});

describe("route", () => {
  const route = buildRoute(readCourse());
  it("puts railings along the cliff-top stretches", () => {
    const metres = route.rails.reduce((m, r) => m + Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z), 0);
    expect(metres).toBeGreaterThan(150);
  });
  it("has gates in course order, the start just ahead of where you begin", () => {
    const idx = route.gates.map((g) => g.index);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(route.gates[0]!.sample.s).toBe(route.settings.startRunUp);
  });
});

describe("skiing the course", () => {
  it("a bot that skis and jets along the walk gets from Icebergs to Tamarama", async () => {
    const { course, route, player, jet, step } = await makeCourse();
    const race = new RaceTracker(route.gates);
    const bot = skiBot(course, jet);
    let top = 0;
    let resets = 0;
    const log: string[] = [];
    for (let tick = 0; tick < 150 / DT && race.state !== "finished"; tick++) {
      const from = { ...player.feet };
      step(bot(player));
      race.tick(DT, from, player.feet);
      // Like the game: the sea sends you back to the last gate.
      if (inSea(course.terrain, player.feet)) {
        const at = route.respawn(race.lastGate);
        player.teleport(at.position);
        Object.assign(player.velocity, at.velocity);
        resets++;
      }
      top = Math.max(top, player.horizontalSpeed);
      if (tick % 200 === 0) log.push(`t=${(tick * DT).toFixed(1)} next=${race.next} pos=${player.feet.x.toFixed(0)},${player.feet.y.toFixed(1)},${player.feet.z.toFixed(0)} v=${player.horizontalSpeed.toFixed(1)} g=${player.grounded} e=${jet.energy.toFixed(2)}`);
    }
    console.log(log.join("\n"), `\ntime ${race.time.toFixed(2)} top ${top.toFixed(1)} splits ${race.splits.map((s) => s.toFixed(1))} resets ${resets}`);
    expect(race.state).toBe("finished");
    expect(resets).toBeLessThanOrEqual(2);
  });
});
