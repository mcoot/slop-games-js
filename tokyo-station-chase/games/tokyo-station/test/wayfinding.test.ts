import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createPhysicsWorld } from "@slop/physics";
import { loadLevel, type Level } from "@slop/level-loader";
import { tokyoMovement as S } from "@slop/fps-controller";
import { initNavigation, Navigation } from "@slop/ai";
import { departureBoard, signArrows, timetable } from "../src/wayfinding";
import { HIKARI_507 } from "../src/round/stationRound";
import { readGlb } from "./harness";

describe("departure board", () => {
  const trains = timetable(HIKARI_507, 300);
  const at = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;

  it("lists the round's train at its departure time", () => {
    const hikari = trains.find((t) => t.number === 507)!;
    expect(hikari).toMatchObject({ time: 14 * 60 + 32, destination: "kyoto", track: 14 });
    expect(hikari.service.en).toBe("Hikari");
  });

  it("shows the next four departures from the station clock", () => {
    const rows = departureBoard(at(14, 27, 0), trains);
    expect(rows.map((r) => r.time)).toEqual(["14:30", "14:32", "14:36", "14:39"]);
    expect(rows[1]).toMatchObject({ train: "ひかり507号 Hikari 507", destination: "京都 Kyoto", track: "14番線 14", status: "" });
  });

  it("flags a train in its last minute, and drops it once it has gone", () => {
    expect(departureBoard(at(14, 31, 30), trains)[0]).toMatchObject({ time: "14:32", status: "departing" });
    expect(departureBoard(at(14, 32, 1), trains)[0]!.time).toBe("14:36");
  });
});

describe("signs", () => {
  let level: Level;
  let nav: Navigation;
  beforeAll(async () => {
    const world = await createPhysicsWorld();
    level = await loadLevel(world, readGlb(fileURLToPath(new URL("../public/levels/tokyo_station.glb", import.meta.url))));
    await initNavigation();
    nav = Navigation.build(level.solids, { radius: S.hullHalfWidth, height: S.standHeight, stepHeight: S.stepHeight, maxSlopeDeg: S.maxWalkableSlopeDeg });
  });

  it("are placed on both floors, pointing to the gates and the ticket machines", () => {
    const signs = level.markers.get("sign")!.map((m) => ({ m, s: signArrows(level, nav, m)! }));
    expect(signs.length).toBeGreaterThan(50);
    expect(signs.some(({ m }) => m.position.y < -1)).toBe(true);
    const toGates = signs.filter(({ s }) => s.spec.rows.some((r) => r.to === "gate-"));
    const toTickets = signs.filter(({ s }) => s.spec.rows.some((r) => r.to === "ticket-machine"));
    expect(toGates.length).toBeGreaterThan(20);
    expect(toTickets.length).toBeGreaterThan(20);
    // Every such sign shows a direction on at least one side.
    const near = (m: { position: { x: number; z: number } }, prefix: string) =>
      [...level.markers.values()].flat().some((t) => t.name.startsWith(prefix) && Math.hypot(t.position.x - m.position.x, t.position.z - m.position.z) < 4);
    for (const { s, m } of [...toGates, ...toTickets]) {
      const i = s.spec.rows.findIndex((r) => r.to === "gate-" || r.to === "ticket-machine");
      if (near(m, s.spec.rows[i]!.to)) continue; // already there: no arrow
      expect(s.front[i] !== "none" || s.back[i] !== "none").toBe(true);
    }
  });

  it("gives the two sides of a hanging sign mirrored arrows", () => {
    const sided = level.markers.get("sign")!.map((m) => signArrows(level, nav, m)!).filter((s) => s.spec.doubleSided);
    const mirror = { left: "right", right: "left", up: "down", down: "up", none: "none" } as const;
    for (const s of sided) s.front.forEach((a, i) => expect(s.back[i]).toBe(mirror[a]));
  });
});
