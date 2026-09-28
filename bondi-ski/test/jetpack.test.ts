import { describe, expect, it } from "vitest";
import { DT, makeCourse } from "./harness";

describe("jetpack", () => {
  it("lifts you at a capped rate and runs out, rather than launching you skywards", async () => {
    const { player, jet, step } = await makeCourse();
    const start = player.feet.y;
    let peak = start;
    let maxRise = 0;
    for (let i = 0; i < 6 / DT; i++) {
      step({ jet: true });
      peak = Math.max(peak, player.feet.y);
      maxRise = Math.max(maxRise, player.velocity.y);
    }
    expect(maxRise).toBeLessThanOrEqual(jet.settings.maxRise + 0.01);
    // A full tank is 2.5 s of thrust: a good hop up a hill, not a trip to the clouds.
    expect(peak - start).toBeGreaterThan(8);
    expect(peak - start).toBeLessThan(25);
    expect(jet.energy).toBeLessThan(0.05);
  });
});
