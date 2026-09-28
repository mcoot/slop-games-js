import { describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { PlayerController, type MoveCommand } from "./playerController";
import { tokyoMovement } from "./settings";

const DT = 0.015;

/** A long 15° slope falling away along -Z from the origin, then flat ground. */
async function slopeWorld() {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const angle = (15 * Math.PI) / 180;
  const len = 200;
  // A thin box tilted about X so its top face falls towards -Z.
  const q = { x: Math.sin(-angle / 2), y: 0, z: 0, w: Math.cos(-angle / 2) };
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(20, 0.5, len / 2)
      .setRotation(q)
      .setTranslation(0, -(len / 2) * Math.sin(angle) - 0.5 * Math.cos(angle), -(len / 2) * Math.cos(angle)),
  );
  world.step();
  const top = { x: 0, y: 0.3, z: -2 };
  return { world, top, angle };
}

const idle: MoveCommand = { forward: 0, side: 0, jumpPresses: 0, jumpHeld: false, crouch: false, walk: false, yaw: 0 };

function run(player: PlayerController, world: RAPIER.World, seconds: number, cmd: Partial<MoveCommand>) {
  for (let i = 0; i < seconds / DT; i++) {
    player.tick({ ...idle, ...cmd }, DT);
    world.step();
  }
}

describe("skiing", () => {
  it("stands still on a gentle slope without skiing", async () => {
    const { world, top } = await slopeWorld();
    const player = new PlayerController(world, { ...tokyoMovement }, top);
    run(player, world, 2, {});
    expect(player.grounded).toBe(true);
    expect(Math.hypot(player.velocity.x, player.velocity.z)).toBeLessThan(0.1);
  });

  it("accelerates down the slope at g·sin(angle) while skiing, staying on the ground", async () => {
    const { world, top, angle } = await slopeWorld();
    const player = new PlayerController(world, { ...tokyoMovement }, top);
    run(player, world, 0.5, {});
    let airborne = 0;
    for (let i = 0; i < 2 / DT; i++) {
      player.tick({ ...idle, ski: true }, DT);
      world.step();
      if (!player.grounded) airborne++;
    }
    const speed = Math.hypot(player.velocity.x, player.velocity.y, player.velocity.z);
    expect(speed).toBeGreaterThan(tokyoMovement.gravity * Math.sin(angle) * 2 * 0.9);
    expect(speed).toBeLessThan(tokyoMovement.gravity * Math.sin(angle) * 2 * 1.05);
    expect(airborne).toBeLessThan(10);
  });

  it("keeps its speed on landing when skiing, loses it when not", async () => {
    for (const ski of [true, false]) {
      const { world, top } = await slopeWorld();
      const player = new PlayerController(world, { ...tokyoMovement }, { ...top, z: -20, y: 2 });
      player.velocity.z = -10;
      run(player, world, 1.5, { ski });
      const speed = Math.hypot(player.velocity.x, player.velocity.z);
      if (ski) expect(speed).toBeGreaterThan(12);
      else expect(speed).toBeLessThan(2);
    }
  });
});
