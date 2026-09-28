import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FpsCameraRig } from "./fpsCamera";
import type { PlayerController } from "./playerController";

/** Just enough of a player standing still for the rig; `landedSpeed` fakes a hard landing. */
function standingPlayer(landedSpeed: number) {
  const feet = { x: 0, y: 0, z: 0 };
  return {
    feet,
    prevFeet: feet,
    eyeHeight: 1.6,
    prevEyeHeight: 1.6,
    grounded: true,
    horizontalSpeed: 0,
    settings: { runSpeed: 7 },
    events: { stepDelta: 0, landedSpeed },
  } as unknown as PlayerController;
}

describe("landing dip", () => {
  it.each([144, 60, 10, 4])("dips and settles back to eye height at %d fps", (fps) => {
    const rig = new FpsCameraRig(new THREE.PerspectiveCamera());
    rig.afterTick(standingPlayer(20));
    let lowest = Infinity;
    for (let t = 0; t < 2; t += 1 / fps) {
      rig.update(standingPlayer(0), 1, 0, 0, 1 / fps);
      lowest = Math.min(lowest, rig.camera.position.y);
      expect(rig.camera.position.y).toBeLessThanOrEqual(1.6 + 1e-6);
    }
    expect(lowest).toBeGreaterThan(1.3);
    expect(rig.camera.position.y).toBeCloseTo(1.6, 3);
  });
});
