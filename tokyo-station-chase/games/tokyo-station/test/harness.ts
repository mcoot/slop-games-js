import * as THREE from "three";
import { addStaticColliders, createPhysicsWorld, type PhysicsWorld } from "@slop/physics";
import { PlayerController, tokyoMovement, type MoveCommand, type Vec3 } from "@slop/fps-controller";
import { movementSandbox } from "../src/levels/movementSandbox";
import { buildBoxLevel } from "../src/levels/buildBoxLevel";

export const DT = 0.015;

export async function makeSandbox(spawn: Vec3) {
  const world: PhysicsWorld = await createPhysicsWorld();
  const level = buildBoxLevel(movementSandbox, () => new THREE.MeshBasicMaterial());
  addStaticColliders(world, level);
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
  return { world, player, run };
}
