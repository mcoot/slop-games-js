import { describe, expect, it } from "vitest";
import { SURFACE_FOOTSTEPS, departureAnnouncements, zoneAt } from "../src/stationAudio";
import { surfaceColors } from "../src/levels/surfaces";
import { HIKARI_507, StationRound } from "../src/round/stationRound";

describe("station audio", () => {
  it("has a footstep sound for every level surface", () => {
    for (const surface of Object.keys(surfaceColors)) expect(SURFACE_FOOTSTEPS[surface], surface).toBeDefined();
    expect(SURFACE_FOOTSTEPS.train).toBe("metal");
    expect(SURFACE_FOOTSTEPS.floor).toBe("tile");
  });

  it("knows which part of the station you're in", () => {
    expect(zoneAt({ y: 0, z: -10 })).toBe("concourse");
    expect(zoneAt({ y: -5, z: -10 })).toBe("b1");
    expect(zoneAt({ y: 5, z: -60 })).toBe("platform");
  });

  it("announces the round's train in Japanese and English, with the jingle a minute before", () => {
    const round = { target: HIKARI_507, departureClock: () => "14:32" } as Pick<StationRound, "target" | "departureClock">;
    const list = departureAnnouncements(round);
    expect(list.map((a) => a.before)).toEqual([200, 60, 12]);
    expect(list[0]!.lines[0]!.text).toContain("14時32分発、ひかり507号、京都行き");
    expect(list[0]!.lines[1]!.text).toContain("Hikari 507 for Kyoto will depart from track 14 at 14:32");
    expect(list.find((a) => a.melody)!.before).toBe(60);
    expect(list.every((a) => a.lines.map((l) => l.lang).join() === "ja-JP,en-US")).toBe(true);
  });
});
