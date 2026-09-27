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

async function makeStation(opts: { spawn?: Vec3; chaser?: { at: Vec3; yaw?: number; state?: "idle" | "search" | "chase" } } = {}) {
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

  const wait = (seconds: number) => {
    for (let t = 0; t < seconds && !round.over; t += DT) tick();
  };

  return { world, level, round, player, bus, chaser, tick, walkTo, wait, time: () => time };
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

describe("station round", () => {
  it("can be won: collect yen, buy a ticket, pass the gates, board", async () => {
    const s = await makeStation();
    const fare = 12650;
    // Collect reachable yen, nearest first, until there's enough for the fare.
    while (s.round.wallet.total < fare) {
      const left = s.round.pickups.items.filter((p) => !p.taken && nav.closestPoint(p.position) && p.position.y < 3);
      expect(left.length, "ran out of reachable yen").toBeGreaterThan(0);
      left.sort((a, b) => hdist(a.position, s.player.feet) - hdist(b.position, s.player.feet));
      const target = left[0]!;
      s.walkTo(target.position, 40);
      target.taken = true; // unreachable ones (on crates) are skipped
    }
    expect(s.round.wallet.total).toBeGreaterThanOrEqual(fare);

    const machine = s.round.machines[0]!;
    expect(s.walkTo({ x: machine.position.x + 0.8, y: 0, z: machine.position.z })).toBe(true);
    s.round.useMachine(machine.position, s.bus);
    const before = s.round.wallet.total;
    payAndTake(s);
    expect(s.round.validFor(s.round.ticket)).toBe(true);
    expect(s.round.wallet.total, "change comes back").toBe(before - fare);

    expect(s.walkTo({ x: -0.8, y: 0, z: -45 }), "through the gates").toBe(true);
    expect(s.walkTo({ x: -8, y: 4, z: -69.7 }), "into the train").toBe(true);
    s.wait(5);
    expect(s.round.state).toBe("won");
    expect(s.round.elapsed).toBeLessThan(s.round.settings.departsIn);
  });

  it("gates stay shut without a ticket, and open with one", async () => {
    const s = await makeStation({ spawn: { x: -0.8, y: 0.05, z: -36 } });
    s.walkTo({ x: -0.8, y: 0, z: -45 }, 4);
    expect(s.player.feet.z).toBeGreaterThan(-39.8); // pressed against the flap at z = -40
    expect(s.round.toasts.some((t) => t.text.includes("check your ticket"))).toBe(true);

    s.round.ticket = { destination: "kyoto", seat: "unreserved", passengers: 1, fare: 12650 };
    expect(s.walkTo({ x: -0.8, y: 0, z: -45 }, 6)).toBe(true);
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
    const s = await makeStation({ spawn: { x: -8, y: 4.05, z: -69.7 } });
    s.round.settings.departsIn = 4;
    s.round.reset();
    s.round.ticket = { destination: "nagoya", seat: "unreserved", passengers: 1, fare: 10560 };
    s.wait(5);
    expect(s.round.state).toBe("missed");
    expect(s.round.reason).toContain("no valid ticket");
  });

  it("the machine's beeps bring the chaser over", async () => {
    // Chaser 8 m from the machines, facing away (east).
    const s = await makeStation({ spawn: { x: -38.1, y: 0.05, z: -24 }, chaser: { at: { x: -31, y: 0.05, z: -24 }, yaw: -Math.PI / 2 } });
    s.wait(0.5);
    expect(s.chaser!.state).toBe("idle");
    s.round.useMachine(s.round.machines[1]!.position, s.bus);
    s.round.wallet.add(10000, 2);
    payAndTake(s);
    expect(["investigate", "chase", "caught"]).toContain(s.chaser!.state);
  });

  it("the chaser goes through the gates (they open for him) and up to the platform", async () => {
    const s = await makeStation({
      spawn: { x: 0, y: 4.05, z: -62 },
      chaser: { at: { x: 0, y: 0.05, z: -34 }, state: "search" },
    });
    s.wait(60);
    expect(s.round.state).toBe("caught");
  });
});
