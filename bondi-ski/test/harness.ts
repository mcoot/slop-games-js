import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPhysicsWorld } from "@slop/physics";
import { PlayerController, yawBasis, type MoveCommand } from "@slop/fps-controller";
import { parseCourse, terrainNormal, type CourseJson } from "../src/course/data";
import { buildRoute } from "../src/course/route";
import { buildCoursePhysics } from "../src/course/physics";
import { buildArenaStructures, clearRoute, loadArenaFile, stampArena } from "../src/course/arenaLevel";
import type { MapDef } from "../src/maps";
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

export function readMapGlb(level: string): ArrayBuffer {
  const bytes = readFileSync(fileURLToPath(new URL(`../public/maps/${level}.glb`, import.meta.url)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * The course's physics with a skier on it, stepped the way the game steps it. With a
 * Blender-built map, set into the course the way the game does it (`arenaSpawns` are its markers).
 */
export async function makeCourse(map?: MapDef) {
  const course = readCourse();
  const file = map?.level ? await loadArenaFile(readMapGlb(map.level), course) : null;
  if (file) stampArena(course, map!.centre, map!.radius, file);
  const route = buildRoute(course);
  if (file) clearRoute(route, map!.centre, map!.radius);
  const world = await createPhysicsWorld();
  const physics = buildCoursePhysics(world, course, route);
  const arenaSpawns = file ? buildArenaStructures(world, file, null).spawns : undefined;
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
  return { course, route, world, player, jet, step, spawn, arenaSpawns };
}
