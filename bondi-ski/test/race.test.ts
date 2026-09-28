import { describe, expect, it } from "vitest";
import type { Gate, Sample } from "../src/course/route";
import { RaceTracker, formatDelta, formatTime } from "../src/race/race";
import { Ghost, GhostRecorder } from "../src/race/ghost";

/** Gates every 10 m along -Z, facing -Z. */
function gates(n: number): Gate[] {
  return Array.from({ length: n }, (_, i) => {
    const sample: Sample = { s: i * 10, x: 0, z: -i * 10, y: 0, tx: 0, tz: -1, rx: 1, rz: 0 };
    return { name: `g${i}`, index: i, sample, pathPoint: { x: 0, y: 0, z: -i * 10 } };
  });
}

describe("race tracker", () => {
  it("starts on the first gate, splits in order and stops at the last", () => {
    const race = new RaceTracker(gates(3), { halfWidth: 5 });
    let z = 5;
    const events = [];
    for (let i = 0; i < 100; i++) {
      const from = { x: 0, y: 0, z };
      z -= 0.5;
      events.push(...race.tick(0.1, from, { x: 0, y: 0, z }).map((e) => ({ ...e })));
    }
    expect(events.map((e) => e.kind)).toEqual(["start", "split", "finish"]);
    // 10 m at 5 m/s between gates.
    expect(events[1]!.time).toBeCloseTo(2, 5);
    expect(race.time).toBeCloseTo(4, 5);
    expect(race.state).toBe("finished");
  });

  it("ignores gates passed out of order, backwards or wide", () => {
    const race = new RaceTracker(gates(3), { halfWidth: 5 });
    // Wide of the start gate: nothing.
    expect(race.tick(0.1, { x: 8, y: 0, z: 1 }, { x: 8, y: 0, z: -1 })).toHaveLength(0);
    // Backwards through it: nothing.
    expect(race.tick(0.1, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 })).toHaveLength(0);
    // Through gate 1 before the start: nothing.
    expect(race.tick(0.1, { x: 0, y: 0, z: -9 }, { x: 0, y: 0, z: -11 })).toHaveLength(0);
    expect(race.state).toBe("ready");
  });

  it("formats times", () => {
    expect(formatTime(62.3456)).toBe("1:02.346");
    expect(formatDelta(-0.5)).toBe("-0.500");
    expect(formatDelta(1.25)).toBe("+1.250");
  });
});

describe("ghost", () => {
  it("interpolates a recording and survives a round trip through base64", () => {
    const rec = new GhostRecorder(0);
    rec.record(0, 0, 0, 0, 0);
    rec.record(1, 10, 2, -10, 1);
    const ghost = Ghost.fromBase64(rec.finish().toBase64());
    const f = ghost.sample(0.5)!;
    expect(f.x).toBeCloseTo(5);
    expect(f.y).toBeCloseTo(1);
    expect(f.z).toBeCloseTo(-5);
    expect(f.yaw).toBeCloseTo(0.5);
    expect(ghost.sample(5)!.x).toBeCloseTo(10);
    expect(ghost.duration).toBe(1);
  });
});
