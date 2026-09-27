import { describe, expect, it } from "vitest";
import { accelerate, airAccelerate, applyFriction, horizontalSpeed, tokyoMovement } from "@slop/fps-controller";
import { DT, makeSandbox } from "./harness";

const S = tokyoMovement;

describe("pmove maths", () => {
  it("friction brings a slow player to a stop quickly", () => {
    const v = { x: 1, y: 0, z: 0 };
    for (let i = 0; i < 40; i++) applyFriction(v, S.friction, S.stopSpeed, DT);
    expect(v.x).toBe(0);
  });

  it("ground acceleration never exceeds wish speed", () => {
    const v = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 200; i++) accelerate(v, { x: 1, y: 0, z: 0 }, 6, S.accelerate, DT);
    expect(v.x).toBeCloseTo(6, 5);
  });

  it("air acceleration perpendicular to velocity adds speed", () => {
    const v = { x: 0, y: 0, z: -6 };
    airAccelerate(v, { x: 1, y: 0, z: 0 }, 6, S.airAccelerate, S.airSpeedCap, DT);
    expect(horizontalSpeed(v)).toBeGreaterThan(6);
  });
});

describe("player in the sandbox", () => {
  it("settles onto the floor", async () => {
    const { player, run } = await makeSandbox({ x: 0, y: 1, z: 10 });
    run(1, {});
    expect(player.grounded).toBe(true);
    expect(player.feet.y).toBeGreaterThan(-0.001);
    expect(player.feet.y).toBeLessThan(0.03);
  });

  it("runs at run speed and walks at walk speed", async () => {
    const { player, run } = await makeSandbox({ x: 45, y: 0.011, z: 10 });
    run(1.5, { forward: 1 });
    expect(player.horizontalSpeed).toBeCloseTo(S.runSpeed, 1);
    run(1.5, { forward: 1, walk: true });
    expect(player.horizontalSpeed).toBeCloseTo(S.walkSpeed, 1);
  });

  it("jumps about a metre", async () => {
    const { player, run } = await makeSandbox({ x: 45, y: 0.011, z: 10 });
    run(0.3, {});
    let apex = 0;
    run(0.015, { jumpPresses: 1 });
    run(1, () => {
      apex = Math.max(apex, player.feet.y);
      return {};
    });
    const expected = (S.jumpSpeed * S.jumpSpeed) / (2 * S.gravity);
    expect(apex).toBeGreaterThan(expected - 0.05);
    expect(apex).toBeLessThan(expected + 0.05);
    expect(player.grounded).toBe(true);
  });

  it("walks up both flights of stairs without jumping", async () => {
    const { player, run } = await makeSandbox({ x: -20, y: 0.011, z: -6 });
    let maxY = 0;
    let airborne = 0;
    run(3.2, () => {
      maxY = Math.max(maxY, player.feet.y);
      if (!player.grounded) airborne++;
      return { forward: 1 };
    });
    expect(maxY).toBeGreaterThan(4.0);
    expect(airborne).toBeLessThanOrEqual(2);
  });

  it("keeps full speed on stairs (risers don't clip velocity)", async () => {
    const { player, run } = await makeSandbox({ x: -20, y: 0.011, z: -4 });
    run(1.3, { forward: 1 });
    expect(player.feet.y).toBeGreaterThan(0.3);
    expect(player.horizontalSpeed).toBeGreaterThan(S.runSpeed * 0.9);
  });

  it.each([15, 30, 44])("walks up the %d° ramp", async (deg) => {
    const x = 10 + [15, 30, 44, 50].indexOf(deg) * 5;
    const { player, run } = await makeSandbox({ x, y: 0.011, z: -6 });
    let maxY = 0;
    run(4, () => {
      maxY = Math.max(maxY, player.feet.y);
      return { forward: 1 };
    });
    expect(maxY).toBeGreaterThan(2.9);
  });

  it("can't walk up the 50° ramp", async () => {
    const { player, run } = await makeSandbox({ x: 25, y: 0.011, z: -6 });
    let maxY = 0;
    run(4, () => {
      maxY = Math.max(maxY, player.feet.y);
      return { forward: 1 };
    });
    expect(maxY).toBeLessThan(2.5);
  });

  it("jumps onto 0.9 m but needs a crouch-jump for 1.3 m, and 1.7 m is out of reach", async () => {
    const tryBox = async (x: number, crouchJump: boolean, crouchDelayTicks = 0) => {
      const { player, run } = await makeSandbox({ x, y: 0.011, z: -24 });
      // Run up and jump ~1.8 m before the box face (at z = -31), so the apex is over the edge.
      let jumped = false;
      let sinceJump = 0;
      run(3, () => {
        const jump = !jumped && player.feet.z < -28.9;
        if (jump) jumped = true;
        else if (jumped) sinceJump++;
        // Let go of forward just before the box so we come to rest on top instead of running off.
        return { forward: player.feet.z > -30.5 ? 1 : 0, jumpPresses: jump ? 1 : 0, crouch: crouchJump && jumped && sinceJump >= crouchDelayTicks };
      });
      return player.feet.y;
    };
    expect(await tryBox(-30, false)).toBeGreaterThan(0.85); // 0.9 m box
    expect(await tryBox(-26, false)).toBeLessThan(0.5); // 1.3 m box, plain jump
    expect(await tryBox(-26, true)).toBeGreaterThan(1.25); // 1.3 m box, crouch pressed with jump
    expect(await tryBox(-26, true, 5)).toBeGreaterThan(1.25); // 1.3 m box, crouch pressed mid-air
    expect(await tryBox(-22, true)).toBeLessThan(0.5); // 1.7 m box
  });

  it("only fits through the tunnel crouched, and can't stand up inside it", async () => {
    const standing = await makeSandbox({ x: 32, y: 0.011, z: -33 });
    standing.run(3, { forward: 1 });
    expect(standing.player.feet.z).toBeGreaterThan(-36.5);

    const crouched = await makeSandbox({ x: 32, y: 0.011, z: -33 });
    crouched.run(2.5, { forward: 1, crouch: true });
    const midZ = crouched.player.feet.z;
    expect(midZ).toBeLessThan(-37);
    crouched.run(0.3, {});
    expect(crouched.player.ducked).toBe(true); // released crouch but no headroom
    crouched.run(4, { forward: 1, crouch: true });
    expect(crouched.player.feet.z).toBeLessThan(-44.5);
    crouched.run(0.5, {});
    expect(crouched.player.ducked).toBe(false);
  });

  it("slides along a wall instead of stopping", async () => {
    // Run at 45° into the east wall.
    const { player, run } = await makeSandbox({ x: 57, y: 0.011, z: -60 });
    run(2, { forward: 1, yaw: -Math.PI / 4 });
    expect(player.feet.x).toBeLessThan(60 - S.hullHalfWidth + 0.02);
    expect(player.horizontalSpeed).toBeGreaterThan(3);
  });

  it("gains speed by strafe-jumping (bunny-hop)", async () => {
    const { player, run } = await makeSandbox({ x: 42, y: 0.011, z: -75 });
    run(1, { forward: 1, yaw: 0 });
    const startSpeed = player.horizontalSpeed;
    run(6, () => {
      // Hold strafe-right and keep the wish direction just past perpendicular to velocity.
      const v = player.velocity;
      const speed = Math.max(horizontalSpeed(v), 0.1);
      const phi = Math.acos(Math.min(1, (S.airSpeedCap - S.airAccelerate * S.runSpeed * DT) / speed));
      const vAngle = Math.atan2(v.z, v.x);
      const wishAngle = vAngle + phi; // turn clockwise seen from above
      const wx = Math.cos(wishAngle);
      const wz = Math.sin(wishAngle);
      const yaw = Math.atan2(-wz, wx); // right(yaw) = (cos yaw, 0, -sin yaw)
      return { side: 1, yaw, jumpPresses: player.grounded ? 1 : 0 };
    });
    expect(player.horizontalSpeed).toBeGreaterThan(startSpeed * 1.5);
  });

  it("caps bunny-hop speed when bhopSpeedCap is set", async () => {
    const { player, run } = await makeSandbox({ x: 45, y: 0.011, z: 10 });
    player.settings.bhopSpeedCap = 1.1;
    player.velocity.x = 0;
    player.velocity.z = -15;
    run(0.2, {});
    run(0.015, { jumpPresses: 1 });
    expect(player.horizontalSpeed).toBeLessThanOrEqual(S.runSpeed * 1.1 + 1e-6);
  });

  it("walks down stairs without going airborne", async () => {
    const { player, run } = await makeSandbox({ x: -20, y: 2.1, z: -16 });
    run(0.5, {});
    let airborneTicks = 0;
    run(1.2, { forward: -1 }); // backwards down the first flight
    run(0.001, {});
    // Step off again, counting airborne ticks.
    const { player: p2, run: run2 } = await makeSandbox({ x: -20, y: 2.1, z: -16 });
    run2(0.5, {});
    run2(1.2, () => {
      if (!p2.grounded) airborneTicks++;
      return { forward: -1 };
    });
    expect(p2.feet.y).toBeLessThan(1.5);
    expect(airborneTicks).toBeLessThanOrEqual(1);
    expect(player.grounded).toBe(true);
  });
});
