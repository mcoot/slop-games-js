import { describe, expect, it } from "vitest";
import { Arena, aimOf, targetOf } from "../src/combat/arena";
import { Fighter } from "../src/combat/fighter";
import { WEAPONS } from "../src/combat/weapons";
import { Jetpack } from "../src/jetpack";
import { bondiSkiMovement } from "../src/movement";
import { DT, makeCourse } from "./harness";

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

async function arena() {
  const { course, route, world, player } = await makeCourse();
  const log: string[] = [];
  const me = { id: "me", body: player, fighter: new Fighter(), jet: new Jetpack() };
  const a = new Arena(world, course, route, bondiSkiMovement, me, {
    shot: () => {},
    impact: () => {},
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
  return { a, me, player, log, step, world };
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

  it("a bot finds you and kills you, you respawn, and it scores", async () => {
    const { a, log, step } = await arena();
    a.addBot("Bot", "#ff0000");
    step(90);
    expect(log.some((l) => l.startsWith("died me by bot-1"))).toBe(true);
    expect(log.some((l) => l === "respawned me")).toBe(true);
    expect(a.match.kills.get("bot-1")).toBeGreaterThanOrEqual(1);
    console.log(log.filter((l) => l.startsWith("died")).length, "deaths in 90 s");
  });

  it("target of a local fighter uses their hull", async () => {
    const { me } = await arena();
    const t = targetOf(me);
    expect(t.height).toBeGreaterThan(1.5);
  });
});
