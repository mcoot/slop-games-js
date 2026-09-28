import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPhysicsWorld } from "@slop/physics";
import { PlayerController, yawBasis, type MoveCommand } from "@slop/fps-controller";
import { parseCourse, terrainNormal, type CourseJson } from "../src/course/data";
import { buildRoute } from "../src/course/route";
import { buildCoursePhysics } from "../src/course/physics";
import { Jetpack } from "../src/jetpack";
import { bondiSkiMovement } from "../src/movement";

export const DT = 0.015;

export function readCourse(name = "icebergs-tamarama") {
  const dir = new URL("../public/course/", import.meta.url);
  const json = JSON.parse(readFileSync(fileURLToPath(new URL(`${name}.json`, dir)), "utf8")) as CourseJson;
  const bytes = readFileSync(fileURLToPath(new URL(json.terrain.file, dir)));
  return parseCourse(json, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

export type BotCommand = Partial<MoveCommand> & { jet?: boolean };

/** The course's physics with a skier on it, stepped the way the game steps it. */
export async function makeCourse() {
  const course = readCourse();
  const route = buildRoute(course);
  const world = await createPhysicsWorld();
  const physics = buildCoursePhysics(world, course, route);
  world.step();
  const spawn = route.respawn(0);
  const player = new PlayerController(world, { ...bondiSkiMovement }, spawn.position);
  player.contactNormal = (n, point, collider) =>
    collider.handle === physics.terrain.handle ? terrainNormal(course.terrain, point.x, point.z) : n;
  const jet = new Jetpack();
  const step = (c: BotCommand) => {
    const cmd: MoveCommand = { forward: 0, side: 0, jumpPresses: 0, jumpHeld: false, crouch: false, walk: false, yaw: spawn.yaw, ...c };
    const { forward, right } = yawBasis(cmd.yaw);
    const wx = forward.x * cmd.forward + right.x * cmd.side;
    const wz = forward.z * cmd.forward + right.z * cmd.side;
    const len = Math.hypot(wx, wz) || 1;
    jet.tick(player, c.jet ?? false, { x: wx / len, y: 0, z: wz / len }, DT);
    player.tick(cmd, DT);
    world.step();
  };
  return { course, route, world, player, jet, step, spawn };
}
