import { afterEach, describe, expect, it, vi } from "vitest";
import { BusTransport, memoryHub } from "../src/net/transport";
import { INTERPOLATION_DELAY_MS, RaceSession } from "../src/net/session";

afterEach(() => vi.useRealTimers());

function room(n: number) {
  vi.useFakeTimers();
  let clock = 0;
  const now = () => clock;
  const hub = memoryHub();
  const log: string[][] = [];
  const racers = Array.from({ length: n }, (_, i) => {
    const events: string[] = [];
    log.push(events);
    const t = new BusTransport(hub.bus(), now, 1000, 4000);
    const s = new RaceSession(t, `racer${i}`, {
      countdown: (slot) => events.push(`countdown ${slot}`),
      go: () => events.push("go"),
      peersChanged: () => {},
    }, (x) => -x, now);
    return s;
  });
  // Step the clock and timers together, so heartbeats see time pass as it would.
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      const step = Math.min(50, ms - t);
      clock += step;
      vi.advanceTimersByTime(step);
    }
  };
  return { racers, log, advance, setClock: (ms: number) => (clock = ms) };
}

describe("race session", () => {
  it("finds everyone in the room and learns their names", () => {
    const { racers } = room(3);
    for (const r of racers) expect(r.peers.size).toBe(2);
    expect([...racers[0]!.peers.values()].map((p) => p.name).sort()).toEqual(["racer1", "racer2"]);
  });

  it("counts everyone down together into a race with distinct start slots", () => {
    const { racers, log, advance } = room(3);
    racers[1]!.startRace();
    for (const r of racers) expect(r.phase).toBe("countdown");
    const slots = log.map((e) => e[0]);
    expect(new Set(slots).size).toBe(3);
    advance(5000);
    for (const r of racers) r.tick({ x: 0, y: 0, z: 0, yaw: 0, time: 0, next: 1 });
    expect(log.map((e) => e.at(-1))).toEqual(["go", "go", "go"]);
    expect(new Set(racers.map((r) => r.race)).size).toBe(1);
  });

  it("ranks finishers by time, then the rest by gates and distance", () => {
    const { racers, advance } = room(3);
    const [a, b, c] = racers as [RaceSession, RaceSession, RaceSession];
    a.startRace();
    advance(5000);
    // a is furthest along (progress is -x here), b finished, c behind a.
    a.tick({ x: -300, y: 0, z: 0, yaw: 0, time: 10, next: 3 });
    c.tick({ x: -100, y: 0, z: 0, yaw: 0, time: 10, next: 3 });
    b.tick({ x: -900, y: 0, z: 0, yaw: 0, time: 10, next: 5 });
    b.gate(4, 61.5, true);
    const order = c.standings({ x: -100, z: 0, next: 3 }).map((s) => s.name);
    expect(order).toEqual(["racer1", "racer0", "racer2"]);
  });

  it("interpolates peers a little behind real time", () => {
    const { racers, advance } = room(2);
    const [a, b] = racers as [RaceSession, RaceSession];
    advance(1000);
    a.tick({ x: 0, y: 0, z: 0, yaw: 0, time: 0, next: 0 });
    advance(100);
    a.tick({ x: 10, y: 0, z: 0, yaw: 0, time: 0, next: 0 });
    advance(INTERPOLATION_DELAY_MS - 50);
    const p = b.sample([...b.peers.values()][0]!)!;
    expect(p.x).toBeCloseTo(5, 5);
  });

  it("notices when someone disappears", () => {
    const { racers, advance } = room(2);
    racers[1]!.transport.leave();
    advance(10);
    expect(racers[0]!.peers.size).toBe(0);
  });
});

describe("between races", () => {
  it("settles on one race when two people start at once", () => {
    vi.useFakeTimers();
    let clock = 0;
    const now = () => clock;
    const hub = memoryHub();
    const mk = (name: string) =>
      new RaceSession(new BusTransport(hub.bus(), now), name, { countdown() {}, go() {}, peersChanged() {} }, () => 0, now);
    const a = mk("a");
    const b = mk("b");
    hub.hold();
    a.startRace();
    b.startRace();
    expect(a.race).not.toBe(b.race);
    hub.flush();
    expect(a.race).toBe(b.race);
    expect(a.phase).toBe("countdown");
    expect(b.phase).toBe("countdown");
  });

  it("waits for everyone still out on the course before starting another race", () => {
    const { racers, advance } = room(2);
    const [a, b] = racers as [RaceSession, RaceSession];
    a.startRace();
    advance(5000);
    for (const r of racers) r.tick({ x: 0, y: 0, z: 0, yaw: 0, time: 1, next: 1 });
    a.gate(4, 50, true);
    // a has finished; b hasn't: a can't start a new race yet...
    expect(a.startRace()).toEqual(["racer1"]);
    expect(b.phase).toBe("racing");
    // ...until b finishes, or a insists.
    b.gate(4, 55, true);
    expect(a.startRace()).toEqual([]);
    expect(b.phase).toBe("countdown");
  });

  it("keeps someone who left the race on the board, at the bottom", () => {
    const { racers, advance } = room(2);
    const [a, b] = racers as [RaceSession, RaceSession];
    a.startRace();
    advance(5000);
    b.quitRace();
    b.tick({ x: 0, y: 0, z: 0, yaw: 0, time: 0, next: 0 });
    const board = a.standings({ x: 0, z: 0, next: 1 });
    expect(board.map((r) => [r.name, r.inRace])).toEqual([
      ["racer0", true],
      ["racer1", false],
    ]);
  });
});

describe("combat session", () => {
  it("passes shots, damage and deaths between players", async () => {
    const { CombatSession } = await import("../src/net/combat");
    const hub = memoryHub();
    const now = () => 0;
    const got: string[] = [];
    const mk = (name: string) =>
      new CombatSession(new BusTransport(hub.bus(), now, 100000), name, {
        peersChanged() {},
        fire: (from, m) => got.push(`${name} saw ${from === a.selfId ? "a" : "b"} fire ${m.w}`),
        hurt: (victim, m) => got.push(`${name} saw hurt ${m.dmg} midair=${m.midair}`),
        died: (victim, by) => got.push(`${name} saw ${victim === b.selfId ? "b" : "a"} killed by ${by === a.selfId ? "a" : "b"}`),
        match: () => {},
      }, now);
    const a = mk("a");
    const b = mk("b");
    a.fire({ w: "disc", x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: -60 });
    b.hurt(a.selfId, "disc", 945, 0, true);
    b.died(a.selfId, "disc");
    expect(got).toEqual(["b saw a fire disc", "a saw hurt 945 midair=true", "a saw b killed by a"]);
    expect([...a.peers.values()][0]!.name).toBe("b");
    a.leave();
    b.leave();
  });

  it("the player in the room longest is the host, and teams and maps travel in the hello", async () => {
    const { CombatSession } = await import("../src/net/combat");
    const hub = memoryHub();
    const now = () => 0;
    const events = { peersChanged() {}, fire() {}, hurt() {}, died() {}, match() {} };
    const mk = (name: string, since: number, map: string) =>
      new CombatSession(new BusTransport(hub.bus(), now, 100000), name, events, now, { since, map, game: "teams" });
    const late = mk("late", 2000, "bondi-beach");
    const early = mk("early", 1000, "marks-park");
    early.setTeam(1);
    expect(late.hostId).toBe(early.selfId);
    expect(early.isHost).toBe(true);
    expect(late.isHost).toBe(false);
    const seen = late.peers.get(early.selfId)!;
    expect(seen.room).toEqual({ since: 1000, map: "marks-park", game: "teams" });
    expect(seen.team).toBe(1);
    // The host leaves: the next longest in takes over.
    early.leave();
    expect(late.isHost).toBe(true);
    late.leave();
  });

  it("shows a skier where they are now, not where they were, and smooths corrections", async () => {
    const { CombatSession, netSettings } = await import("../src/net/combat");
    const hub = memoryHub();
    let clock = 0;
    const now = () => clock;
    const events = { peersChanged() {}, fire() {}, hurt() {}, died() {}, match() {} };
    const skier = new CombatSession(new BusTransport(hub.bus(), now, 100000), "skier", events, now);
    const shooter = new CombatSession(new BusTransport(hub.bus(), now, 100000), "shooter", events, now);
    const seen = shooter.peers.get(skier.selfId)!;
    seen.latency = 0.05;
    const state = (x: number, vx: number) => ({ x, y: 0, z: 0, yaw: 0, pitch: 0, vx, vy: 0, vz: 0, alive: true, hp: 900, w: "disc", air: false });
    // Skiing at 20 m/s: states every 50 ms.
    for (let i = 0; i <= 10; i++) {
      clock = i * 50;
      skier.tick(state(i, 20));
    }
    // 30 ms after the last state (at x = 10, sent 50 ms before it arrived), they're 1.6 m on.
    clock = 530;
    expect(shooter.pose(seen)!.x).toBeCloseTo(10 + 20 * 0.08, 1);
    // Interpolating in the past would put them metres behind.
    expect(shooter.sample(seen)!.x).toBeLessThan(8.5);
    // They stop dead: the new state disagrees with the guess, and the difference fades.
    clock = 550;
    skier.tick(state(10.5, 0));
    expect(shooter.pose(seen)!.x).toBeGreaterThan(11);
    clock = 550 + netSettings.smoothing * 1000 * 5;
    expect(shooter.pose(seen)!.x).toBeCloseTo(10.5, 1);
    // A respawn far away snaps rather than sliding across the map.
    clock += 50;
    skier.tick(state(200, 0));
    expect(shooter.pose(seen)!.x).toBeCloseTo(200, 1);
    skier.leave();
    shooter.leave();
  });

  it("falls with gravity in the air but not through the ground", async () => {
    const { CombatSession, netSettings } = await import("../src/net/combat");
    const hub = memoryHub();
    let clock = 0;
    const now = () => clock;
    const events = { peersChanged() {}, fire() {}, hurt() {}, died() {}, match() {} };
    const flyer = new CombatSession(new BusTransport(hub.bus(), now, 100000), "flyer", events, now);
    const watcher = new CombatSession(new BusTransport(hub.bus(), now, 100000), "watcher", events, now);
    watcher.ground = () => 9.9;
    const seen = watcher.peers.get(flyer.selfId)!;
    seen.latency = 0;
    flyer.tick({ x: 0, y: 10, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, alive: true, hp: 900, w: "disc", air: true });
    clock = 100;
    expect(watcher.pose(seen)!.y).toBeCloseTo(10 - 0.5 * netSettings.gravity * 0.01, 2);
    clock = 300;
    expect(watcher.pose(seen)!.y).toBeCloseTo(9.9, 2);
    flyer.leave();
    watcher.leave();
  });
});
