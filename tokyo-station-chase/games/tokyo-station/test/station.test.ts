import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createPhysicsWorld } from "@slop/physics";
import { loadLevel } from "@slop/level-loader";
import { PlayerController, tokyoMovement as S } from "@slop/fps-controller";
import { Chaser, HintDirector, initNavigation, Navigation, NoiseBus, yawTo, type Vec3 } from "@slop/ai";
import { StationRound } from "../src/round/stationRound";
import { DENOMINATIONS } from "../src/round/yen";
import { DT, readGlb } from "./harness";

const STATION_GLB = fileURLToPath(new URL("../public/levels/tokyo_station.glb", import.meta.url));
const AGENT = { radius: S.hullHalfWidth, height: S.standHeight, stepHeight: S.stepHeight, maxSlopeDeg: S.maxWalkableSlopeDeg };
const hdist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

let nav: Navigation;
beforeAll(async () => {
  const world = await createPhysicsWorld();
  const level = await loadLevel(world, readGlb(STATION_GLB));
  await initNavigation();
  nav = Navigation.build(level.solids, AGENT);
});

async function makeStation(opts: { spawn?: Vec3; chaser?: { at: Vec3; yaw?: number; state?: "idle" | "search" | "chase" | "investigate" } } = {}) {
  const world = await createPhysicsWorld();
  const level = await loadLevel(world, readGlb(STATION_GLB));
  const round = new StationRound(world, level);
  world.step();
  const player = new PlayerController(world, { ...S }, opts.spawn ?? level.spawn.position);
  const bus = new NoiseBus();
  const chaser = opts.chaser
    ? new Chaser(world, nav, { position: opts.chaser.at, yaw: opts.chaser.yaw ?? 0 }, {
        director: Object.assign(new HintDirector(), { chokepoints: (level.markers.get("chokepoint") ?? []).map((m) => m.position) }),
        state: opts.chaser.state ?? "idle",
        random: () => 0.5,
      })
    : null;
  let time = 0;

  /** One game tick, in the same order as the game. */
  const tick = (forward = 0, yaw = 0) => {
    player.tick({ forward, side: 0, jumpPresses: 0, jumpHeld: false, crouch: false, walk: false, yaw }, DT);
    const p = { x: player.feet.x, y: player.feet.y, z: player.feet.z };
    round.tick(DT, p, chaser ? { ...chaser.body.feet } : null, bus);
    if (chaser) {
      chaser.update(
        DT,
        { feet: p, eye: { ...p, y: p.y + player.eyeHeight }, velocity: { ...player.velocity }, colliderHandle: player.colliderHandle },
        bus.drain(),
      );
      if (chaser.events.caught) round.caught();
    } else {
      bus.drain();
    }
    world.step();
    time += DT;
  };

  /** Walk along the navmesh to `to`, as a player holding W and steering would. */
  const walkTo = (to: Vec3, maxSeconds = 60) => {
    let path: Vec3[] = [];
    let wp = 1;
    let repath = 0;
    for (let t = 0; t < maxSeconds && !round.over; t += DT) {
      if (hdist(player.feet, to) < 0.5 && Math.abs(player.feet.y - to.y) < 1) return true;
      if ((repath -= DT) <= 0) {
        path = nav.path(player.feet, to);
        wp = 1;
        repath = 0.5;
      }
      while (wp < path.length - 1 && hdist(player.feet, path[wp]!) < 0.4) wp++;
      const next = path[wp] ?? to;
      tick(1, yawTo(player.feet, next));
    }
    return hdist(player.feet, to) < 0.5;
  };

  /** Crouch-walk in a straight line (under counters, where the navmesh doesn't go). */
  const crouchTo = (to: Vec3, maxSeconds = 15) => {
    for (let t = 0; t < maxSeconds && !round.over; t += DT) {
      if (hdist(player.feet, to) < 0.4) break;
      player.tick({ forward: 1, side: 0, jumpPresses: 0, jumpHeld: false, crouch: true, walk: false, yaw: yawTo(player.feet, to) }, DT);
      round.tick(DT, { x: player.feet.x, y: player.feet.y, z: player.feet.z }, null, bus);
      bus.drain();
      world.step();
      time += DT;
    }
    // Stand back up.
    for (let t = 0; t < 0.5; t += DT) tick();
    return hdist(player.feet, to) < 0.4;
  };

  const wait = (seconds: number) => {
    for (let t = 0; t < seconds && !round.over; t += DT) tick();
  };

  return { world, level, round, player, bus, chaser, tick, walkTo, crouchTo, wait, time: () => time };
}

/** Pay with the biggest pieces first, like someone in a hurry. */
function payAndTake(s: Awaited<ReturnType<typeof makeStation>>) {
  const m = s.round.machine!;
  const press = (id: string) => {
    m.press(id);
    for (let i = 0; i < 400 && m.view().busy; i++) s.tick();
  };
  press("dest:kyoto");
  press("seat:unreserved");
  press("pax:1");
  for (const d of [...DENOMINATIONS].reverse()) {
    while (m.screen === "pay" && s.round.wallet.count(d) > 0 && d > 5) press(`insert:${d}`);
  }
  press("take");
  s.tick(); // the round picks up the ticket
}

describe("station level", () => {
  it("has two floors, two machine banks, two gate lines, hiding places and a patrol", async () => {
    const s = await makeStation();
    const m = s.level.markers;
    const machines = m.get("interact")!;
    expect(new Set(machines.map((x) => (x.position.y < -1 ? "B1" : "concourse")))).toEqual(new Set(["B1", "concourse"]));
    expect(new Set(m.get("gate")!.map((g) => Math.sign(g.position.x)))).toEqual(new Set([-1, 1]));
    expect(m.get("patrol_point")!.length).toBeGreaterThanOrEqual(6);
    expect(s.level.triggers.filter((t) => t.name.startsWith("hide")).length).toBeGreaterThanOrEqual(3);
    // The chaser spawns out of sight and far (by path) from the player.
    expect(nav.pathLength(s.level.spawn.position, m.get("chaser_spawn")![0]!.position)).toBeGreaterThan(60);
  });

  it("puts some yen where only you can go: under counters and on the low kiosk", async () => {
    const s = await makeStation();
    const playerOnly = s.round.pickups.items.filter((p) => !Number.isFinite(nav.pathLength(s.level.spawn.position, p.position)) || hdist(nav.path(s.level.spawn.position, p.position).at(-1)!, p.position) > 0.8 || Math.abs(nav.path(s.level.spawn.position, p.position).at(-1)!.y - p.position.y) > 0.6);
    expect(playerOnly.map((p) => p.value)).toEqual([1000, 1000, 1000, 1000]);
    // Walking alone doesn't pay the fare: you need those routes.
    expect(s.round.pickups.total - 4000).toBeLessThan(12650);
  });
});

describe("station round", () => {
  it("can be won: collect yen (including under a counter), buy a ticket, pass the gates, board", async () => {
    const s = await makeStation();
    const fare = 12650;
    // The ¥1,000 under the counter east of the spawn: only a crouching player gets it.
    expect(s.walkTo({ x: 4, y: 0, z: -17 })).toBe(true);
    expect(s.crouchTo({ x: 12, y: 0, z: -17 })).toBe(true);
    expect(s.crouchTo({ x: 5, y: 0, z: -17 })).toBe(true);
    // Then walkable yen, nearest (by path) first, until there's enough for the fare.
    while (s.round.wallet.total < fare) {
      const left = s.round.pickups.items.filter((p) => !p.taken && Number.isFinite(nav.pathLength(s.player.feet, p.position)));
      expect(left.length, "ran out of reachable yen").toBeGreaterThan(0);
      const lengths = new Map(left.map((p) => [p, nav.pathLength(s.player.feet, p.position)]));
      left.sort((a, b) => lengths.get(a)! - lengths.get(b)!);
      const target = left[0]!;
      s.walkTo(target.position, 40);
      target.taken = true; // skip it even if the walk fell short
    }
    expect(s.round.wallet.total).toBeGreaterThanOrEqual(fare);

    // The nearest machine bank by path, then the nearest gate line.
    const machine = [...s.round.machines].sort(
      (a, b) => nav.pathLength(s.player.feet, a.position) - nav.pathLength(s.player.feet, b.position),
    )[0]!;
    const facing = s.level.markers.get("interact")!.find((m) => m.name === machine.id)!;
    const front = { x: machine.position.x - Math.sin(facing.yaw) * 0.7, y: machine.position.y - 1.15, z: machine.position.z - Math.cos(facing.yaw) * 0.7 };
    expect(s.walkTo(front), "to the machine").toBe(true);
    s.round.useMachine(machine.position, s.bus);
    const before = s.round.wallet.total;
    payAndTake(s);
    expect(s.round.validFor(s.round.ticket)).toBe(true);
    expect(s.round.wallet.total, "change comes back").toBe(before - fare);

    const gates = s.level.markers.get("gate")!.map((g) => ({ x: g.position.x, y: 0, z: g.position.z - 3 }));
    gates.sort((a, b) => nav.pathLength(s.player.feet, a) - nav.pathLength(s.player.feet, b));
    expect(s.walkTo(gates[0]!), "through the gates").toBe(true);
    expect(s.walkTo({ x: -8, y: 5, z: -66.2 }), "into the train").toBe(true);
    s.wait(5);
    expect(s.round.state).toBe("won");
    expect(s.round.elapsed).toBeLessThan(s.round.settings.departsIn);
  });

  it("gates stay shut without a ticket, and open with one", async () => {
    // Marunouchi-side gates: passages at x = -44 ± 0.8, flaps at z = -45.
    const s = await makeStation({ spawn: { x: -44.8, y: 0.05, z: -42 } });
    s.walkTo({ x: -44.8, y: 0, z: -49 }, 4);
    expect(s.player.feet.z).toBeGreaterThan(-44.8); // pressed against the flap
    expect(s.round.toasts.some((t) => t.text.includes("check your ticket"))).toBe(true);

    s.round.ticket = { destination: "kyoto", seat: "unreserved", passengers: 1, fare: 12650 };
    expect(s.walkTo({ x: -44.8, y: 0, z: -49 }, 6)).toBe(true);
  });

  it("the train leaves without you at departure, and its doors shut", async () => {
    const s = await makeStation();
    s.round.settings.departsIn = 3;
    s.round.reset();
    s.wait(4);
    expect(s.round.state).toBe("missed");
    expect(s.round.doors.closed).toBe(true);
    expect(s.round.doors.doors.every((d) => d.collider.isEnabled())).toBe(true);
  });

  it("the conductor won't take you without the right ticket", async () => {
    const s = await makeStation({ spawn: { x: -8, y: 5.05, z: -66.2 } });
    s.round.settings.departsIn = 4;
    s.round.reset();
    s.round.ticket = { destination: "nagoya", seat: "unreserved", passengers: 1, fare: 10560 };
    s.wait(5);
    expect(s.round.state).toBe("missed");
    expect(s.round.reason).toContain("no valid ticket");
  });

  it("the machine's beeps bring the chaser over", async () => {
    // At the central machines, with the chaser 7.5 m away facing away (east).
    const s = await makeStation({ spawn: { x: -7, y: 0.05, z: -30.2 }, chaser: { at: { x: 0.5, y: 0.05, z: -30 }, yaw: -Math.PI / 2 } });
    s.wait(0.5);
    expect(s.chaser!.state).toBe("idle");
    s.round.useMachine(s.round.machines.find((m) => m.id.includes("central-1"))!.position, s.bus);
    s.round.wallet.add(10000, 2);
    payAndTake(s);
    expect(["investigate", "chase", "caught"]).toContain(s.chaser!.state);
  });

  it("the chaser goes through the gates (they open for him) and up to the platform", async () => {
    const s = await makeStation({
      spawn: { x: 0, y: 5.05, z: -60 },
      chaser: { at: { x: -44, y: 0.05, z: -38 }, state: "investigate" },
    });
    s.chaser!.lastKnown = { x: 0, y: 5.05, z: -60 }; // he heard something up there
    s.wait(60);
    expect(s.round.state).toBe("caught");
  });
});
