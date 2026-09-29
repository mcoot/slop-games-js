import { describe, expect, it } from "vitest";
import { Arena, aimOf, targetOf } from "../src/combat/arena";
import { Fighter } from "../src/combat/fighter";
import { WEAPONS } from "../src/combat/weapons";
import { Jetpack } from "../src/jetpack";
import { bondiSkiMovement } from "../src/movement";
import { heightAt, inSea } from "../src/course/data";
import { buildArenaWall } from "../src/course/physics";
import { layoutFor, mapById, MAPS } from "../src/maps";
import { DT, makeCourse } from "./harness";

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

async function arena(mapId = "coastal-walk") {
  const map = mapById(mapId);
  const { course, route, world, player, arenaSpawns } = await makeCourse(map);
  const layout = layoutFor(map, course, route, arenaSpawns);
  if (layout.walled) buildArenaWall(world, course, map.centre, map.radius);
  const log: string[] = [];
  const impacts: { x: number; z: number }[] = [];
  const me = { id: "me", body: player, fighter: new Fighter(), jet: new Jetpack() };
  const a = new Arena(world, course, layout, bondiSkiMovement, me, {
    shot: () => {},
    impact: (i) => impacts.push({ x: i.point.x, z: i.point.z }),
    hurt: (v, by, w, hit, hp) => log.push(`hurt ${v} by ${by} ${w.id} ${hit.damage}${hit.midair ? " midair" : ""} -> ${hp}`),
    died: (v, by) => log.push(`died ${v} by ${by}`),
    respawned: (id) => log.push(`respawned ${id}`),
  }, seeded(7));
  const step = (seconds: number, each?: () => void) => {
    for (let i = 0; i < seconds / DT; i++) {
      each?.();
      a.stepBots(DT, (bot) => [me, ...a.bots.filter((b) => b !== bot)].map((l) => ({ id: l.id, feet: { ...l.body.feet }, velocity: { ...l.body.velocity }, alive: "fighter" in l ? l.fighter.alive : true })));
      player.tick({ forward: 0, side: 0, jumpPresses: 0, jumpHeld: false, crouch: false, walk: false, yaw: 0 }, DT);
      world.step();
      a.step(DT);
    }
  };
  return { a, me, player, log, step, world, course, map, impacts };
}

describe("arena", () => {
  it("has spawn points on land all along the course", async () => {
    const { a } = await arena();
    expect(a.spawns.length).toBeGreaterThan(20);
  });

  it("a disc fired at your feet throws you up (disc jump) and costs a little health", async () => {
    const { a, me, player, step } = await arena();
    step(0.5);
    const eye = { x: player.feet.x, y: player.feet.y + player.eyeHeight, z: player.feet.z };
    a.fire("me", WEAPONS.disc, eye, aimOf(0, -1.5), { x: 0, y: 0, z: 0 });
    let peak = player.feet.y;
    const start = player.feet.y;
    step(1.5, () => (peak = Math.max(peak, player.feet.y)));
    expect(peak - start).toBeGreaterThan(3);
    expect(me.fighter.health).toBeLessThan(900);
    expect(me.fighter.health).toBeGreaterThan(600);
  });

  it.each(["coastal-walk", "marks-park", "sculpture-park"])("a bot finds you and kills you, you respawn, and it scores (%s)", async (id) => {
    const { a, log, step } = await arena(id);
    a.addBot("Bot", "#ff0000");
    step(90);
    expect(log.some((l) => l.startsWith("died me by bot-1"))).toBe(true);
    expect(log.some((l) => l === "respawned me")).toBe(true);
    expect(a.match.kills.get("bot-1")).toBeGreaterThanOrEqual(1);
    console.log(log.filter((l) => l.startsWith("died")).length, "deaths in 90 s");
  });

  it.each(MAPS.filter((m) => m.walled).map((m) => m.id))("%s has spawns spread inside its wall, on dry land", async (id) => {
    const { a, course, map } = await arena(id);
    expect(a.spawns.length).toBeGreaterThanOrEqual(10);
    for (const s of a.spawns) {
      expect(Math.hypot(s.x - map.centre.x, s.z - map.centre.z)).toBeLessThan(map.radius);
      expect(inSea(course.terrain, s)).toBe(false);
    }
  });

  it("the arena wall stops you skiing out, and discs burst on it", async () => {
    const { a, player, step, map, course, impacts } = await arena("marks-park");
    // Stand 12 m inside the wall on the landward (west) side and charge straight out.
    const x = map.centre.x - (map.radius - 12);
    const z = map.centre.z;
    player.teleport({ x, y: heightAt(course.terrain, x, z) + 1, z });
    let furthest = 0;
    step(3, () => {
      player.velocity.x = -25;
      player.velocity.z = 0;
      furthest = Math.max(furthest, Math.hypot(player.feet.x - map.centre.x, player.feet.z - map.centre.z));
    });
    expect(furthest).toBeLessThan(map.radius);
    // A disc fired flat at the wall bursts on it.
    const eye = { x: player.feet.x, y: player.feet.y + player.eyeHeight, z: player.feet.z };
    a.fire("me", WEAPONS.disc, eye, aimOf(Math.PI / 2, 0), { x: 0, y: 0, z: 0 });
    step(1);
    expect(impacts.length).toBe(1);
    expect(Math.hypot(impacts[0]!.x - map.centre.x, impacts[0]!.z - map.centre.z)).toBeCloseTo(map.radius, -1);
  });

  it("target of a local fighter uses their hull", async () => {
    const { me } = await arena();
    const t = targetOf(me);
    expect(t.height).toBeGreaterThan(1.5);
  });
});
