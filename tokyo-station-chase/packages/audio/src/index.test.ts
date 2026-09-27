import { describe, expect, it } from "vitest";
import { DEPARTURE_JINGLE, FOOTSTEP_PROFILES, footstepMaterial, melodyDuration, midiToHz } from "./index";

describe("footsteps", () => {
  const table = { floor: "tile", train: "metal", prop: "wood" } as const;
  it("maps level surfaces to footstep materials, with a fallback", () => {
    expect(footstepMaterial("floor", table)).toBe("tile");
    expect(footstepMaterial("train", table)).toBe("metal");
    expect(footstepMaterial("nothing-known", table)).toBe("concrete");
    expect(footstepMaterial(undefined, table, "rubber")).toBe("rubber");
  });
  it("has a profile for every material", () => {
    for (const m of ["tile", "concrete", "metal", "wood", "rubber"] as const) expect(FOOTSTEP_PROFILES[m].gain).toBeGreaterThan(0);
  });
});

describe("melody", () => {
  it("converts MIDI to pitch", () => {
    expect(midiToHz(69)).toBeCloseTo(440);
    expect(midiToHz(81)).toBeCloseTo(880);
  });
  it("the departure jingle lasts a few seconds", () => {
    const seconds = melodyDuration(DEPARTURE_JINGLE, 132);
    expect(seconds).toBeGreaterThan(3);
    expect(seconds).toBeLessThan(6);
  });
});
