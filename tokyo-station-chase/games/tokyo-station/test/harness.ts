import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPhysicsWorld, type PhysicsWorld } from "@slop/physics";
import { loadLevel } from "@slop/level-loader";
import { PlayerController, tokyoMovement, type MoveCommand, type Vec3 } from "@slop/fps-controller";

export const DT = 0.015;

/** The exported sandbox level, exactly what the game loads. */
export const SANDBOX_GLB = fileURLToPath(new URL("../public/levels/movement_sandbox.glb", import.meta.url));

export function readGlb(path = SANDBOX_GLB): ArrayBuffer {
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export async function makeSandbox(spawn: Vec3) {
  const world: PhysicsWorld = await createPhysicsWorld();
  const level = await loadLevel(world, readGlb());
  world.step();
  const player = new PlayerController(world, { ...tokyoMovement }, spawn);
  const run = (seconds: number, cmd: Partial<MoveCommand> | ((t: number) => Partial<MoveCommand>)) => {
    const ticks = Math.round(seconds / DT);
    for (let i = 0; i < ticks; i++) {
      const c = typeof cmd === "function" ? cmd(i * DT) : cmd;
      player.tick({ forward: 0, side: 0, jumpPresses: 0, jumpHeld: false, crouch: false, walk: false, yaw: 0, ...c }, DT);
      world.step();
    }
  };
  return { world, level, player, run };
}
