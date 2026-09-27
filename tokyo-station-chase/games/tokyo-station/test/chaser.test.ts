import { beforeAll, describe, expect, it } from "vitest";
import { createPhysicsWorld } from "@slop/physics";
import { loadLevel } from "@slop/level-loader";
import { tokyoMovement as S, PlayerController, type MoveCommand } from "@slop/fps-controller";
import {
  Chaser,
  HintDirector,
  initNavigation,
  MovementNoise,
  Navigation,
  NoiseBus,
  yawTo,
  type ChaserState,
  type Vec3,
} from "@slop/ai";
import { DT, readGlb } from "./harness";

const AGENT = { radius: S.hullHalfWidth, height: S.standHeight, stepHeight: S.stepHeight, maxSlopeDeg: S.maxWalkableSlopeDeg };

/** Small seeded PRNG so search decisions are repeatable. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nav: Navigation;
beforeAll(async () => {
  const world = await createPhysicsWorld();
  const level = await loadLevel(world, readGlb());
  await initNavigation();
  nav = Navigation.build(level.solids, AGENT);
});

/** Player and chaser in the sandbox. `run` ticks both, like the game does. */
async function makeChase(playerAt: Vec3, chaserAt: Vec3, opts: { state?: ChaserState; facePlayer?: boolean; seed?: number } = {}) {
  const world = await createPhysicsWorld();
  const level = await loadLevel(world, readGlb());
  const director = new HintDirector();
  director.chokepoints = (level.markers.get("chokepoint") ?? []).map((m) => m.position);
  world.step();
  const player = new PlayerController(world, { ...S }, playerAt);
  const yaw = opts.facePlayer ? yawTo(chaserAt, playerAt) : 0;
  const chaser = new Chaser(world, nav, { position: chaserAt, yaw }, {
    director,
    random: seeded(opts.seed ?? 1),
    state: opts.state ?? "search",
  });
  const bus = new NoiseBus();
  const noise = new MovementNoise();
  const states = new Set<ChaserState>();
  let caughtAt = -1;
  let t = 0;
  const run = (seconds: number, cmd: Partial<MoveCommand> = {}, until?: () => boolean) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      player.tick({ forward: 0, side: 0, jumpPresses: 0, jumpHeld: false, crouch: false, walk: false, yaw: 0, ...cmd }, DT);
      noise.update(player, bus);
      const p = player.feet;
      chaser.update(
        DT,
        {
          feet: { x: p.x, y: p.y, z: p.z },
          eye: { x: p.x, y: p.y + player.eyeHeight, z: p.z },
          velocity: { ...player.velocity },
          colliderHandle: player.colliderHandle,
        },
        bus.drain(),
      );
      world.step();
      t += DT;
      states.add(chaser.state);
      if (chaser.events.caught && caughtAt < 0) caughtAt = t;
      if (until?.()) return;
    }
  };
  return { world, player, chaser, run, states, caught: () => caughtAt };
}

const hdist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

describe("navmesh", () => {
  const reaches = (from: Vec3, to: Vec3) => {
    const end = nav.path(from, to).at(-1);
    return end !== undefined && Math.hypot(end.x - to.x, end.z - to.z) < 1 && Math.abs(end.y - to.y) < 0.5;
  };

  it("goes up both flights of stairs and the 44° ramp", () => {
    expect(reaches({ x: -20, y: 0, z: -5 }, { x: -20, y: 4.04, z: -26 })).toBe(true);
    expect(reaches({ x: 20, y: 0, z: -5 }, { x: 20, y: 3, z: -14 })).toBe(true);
  });

  it("can't go up the 50° ramp, onto a 1.3 m box or through the crouch tunnel", () => {
    expect(reaches({ x: 25, y: 0, z: -5 }, { x: 25, y: 3, z: -13 })).toBe(false);
    expect(reaches({ x: -26, y: 0, z: -28 }, { x: -26, y: 1.3, z: -32 })).toBe(false);
    expect(reaches({ x: 32, y: 0, z: -30 }, { x: 32, y: 0, z: -40 })).toBe(false);
  });
});

describe("chaser", () => {
  it("runs down and catches a player standing in view", async () => {
    const c = await makeChase({ x: 0, y: 0.05, z: 10 }, { x: 0, y: 0.05, z: -10 }, { facePlayer: true });
    c.run(8, {}, () => c.caught() >= 0);
    expect(c.states.has("chase")).toBe(true);
    expect(c.caught()).toBeGreaterThan(0);
    expect(c.caught()).toBeLessThan(6);
  });

  it("follows a player up the stairs", async () => {
    const c = await makeChase({ x: -20, y: 4.1, z: -25 }, { x: -20, y: 0.05, z: -4 }, { facePlayer: true });
    c.run(20, {}, () => c.caught() >= 0);
    expect(c.caught()).toBeGreaterThan(0);
  });

  it("hears running but not walking at 10 m", async () => {
    // It faces away from the player, so only hearing can give them away.
    for (const [walk, expected] of [[false, "investigate"], [true, "idle"]] as const) {
      const c = await makeChase({ x: 0, y: 0.05, z: -20 }, { x: 0, y: 0.05, z: -30 }, { state: "idle" });
      c.run(1.5, { side: 1, walk });
      // Once it hears running it turns to look, and may see the player straight away.
      if (walk) expect(c.chaser.state, "walking").toBe(expected);
      else expect(["investigate", "chase"], "running").toContain(c.chaser.state);
    }
  });

  it("hears a hard landing further away than a footstep", async () => {
    const c = await makeChase({ x: 0, y: 0.05, z: -12 }, { x: 0, y: 0.05, z: -30 }, { state: "idle" });
    c.run(0.5);
    expect(c.chaser.state).toBe("idle");
    c.run(1.2, { jumpPresses: 1 }, () => c.chaser.state !== "idle");
    expect(c.chaser.state).toBe("investigate");
  });

  it("finds a far-away player who keeps still, from fuzzy hints rather than their exact position", async () => {
    // Standing still among the low-ceiling hall's pillars, ~115 m from the chaser, making no noise.
    const hide = { x: -44, y: 0.05, z: -73 };
    const c = await makeChase(hide, { x: 40, y: 0.05, z: 0 }, { seed: 7 });
    const guesses: Vec3[] = [];
    c.run(120, {}, () => {
      const d = c.chaser.directive;
      if (d && d.kind === "hint" && guesses.at(-1) !== d.position) guesses.push(d.position);
      return c.caught() >= 0;
    });
    expect(c.caught()).toBeGreaterThan(0);
    // Hints were fuzzy: not the hiding place itself.
    expect(guesses.length).toBeGreaterThan(0);
    expect(guesses.every((g) => hdist(g, hide) > 0.5)).toBe(true);
  });

  it("waits at the nearest reachable point when it can see but not reach the player", async () => {
    // Player crouched in the tunnel, chaser outside the south end looking in.
    const c = await makeChase({ x: 32, y: 0.05, z: -40 }, { x: 32, y: 0.05, z: -48 }, { facePlayer: true });
    c.run(15, { crouch: true });
    expect(c.caught()).toBeLessThan(0);
    expect(c.chaser.state).toBe("chase");
    // Parked at the tunnel mouth, as close as it can get.
    expect(hdist(c.chaser.body.feet, { x: 32, y: 0, z: -44.5 })).toBeLessThan(1.5);
  });

  it("only catches up when the player is out of sight and far away", async () => {
    const far = await makeChase({ x: 0, y: 0.05, z: 10 }, { x: 0, y: 0.05, z: -40 }); // facing away
    far.run(0.6);
    expect(far.chaser.catchingUp).toBe(true);

    const seen = await makeChase({ x: 0, y: 0.05, z: 10 }, { x: 0, y: 0.05, z: -30 }, { facePlayer: true });
    seen.run(0.6);
    expect(seen.chaser.state).toBe("chase");
    expect(seen.chaser.catchingUp).toBe(false);

    const near = await makeChase({ x: 0, y: 0.05, z: 10 }, { x: 0, y: 0.05, z: -5 }); // facing away, 15 m
    near.run(0.6);
    expect(near.chaser.catchingUp).toBe(false);
  });

  it("is slower than a running player while it can see them", async () => {
    // Open ground along x = 45, running away down -Z in plain view.
    const c = await makeChase({ x: 45, y: 0.05, z: -20 }, { x: 45, y: 0.05, z: 0 }, { facePlayer: true });
    c.run(0.5);
    const gap0 = hdist(c.player.feet, c.chaser.body.feet);
    c.run(4, { forward: 1 });
    expect(c.chaser.state).toBe("chase");
    expect(hdist(c.player.feet, c.chaser.body.feet)).toBeGreaterThan(gap0);
  });
});
