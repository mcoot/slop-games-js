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
  const advance = (ms: number) => {
    clock += ms;
    vi.advanceTimersByTime(ms);
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
