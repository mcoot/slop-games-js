import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPhysicsWorld, type PhysicsWorld } from "@slop/physics";
import { parseCourse, type CourseData, type CourseJson } from "../src/course/data";
import { buildRoute } from "../src/course/route";
import { buildArenaWall, buildCoursePhysics } from "../src/course/physics";
import { buildArenaStructures, clearRoute, loadArenaFile, stampArena } from "../src/course/arenaLevel";
import { layoutFor, MAPS, type ArenaLayout } from "../src/maps";

/** A map as the server needs it: something solid for projectiles to hit, and the arena's shape. */
export interface ArenaWorld {
  world: PhysicsWorld;
  course: CourseData;
  layout: ArenaLayout;
}

const COURSE = "icebergs-tamarama";

function bytes(path: string): ArrayBuffer {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/**
 * Build every deathmatch map's collision the way the game does (course, Blender-built
 * structures, the arena wall), from the game's own data files in `dataDir` (its `public/`).
 * Projectiles only ray cast against these, so rooms on the same map share one.
 */
export async function loadWorlds(dataDir: string, only?: string[]): Promise<Map<string, ArenaWorld>> {
  const out = new Map<string, ArenaWorld>();
  for (const map of MAPS) {
    if (only && !only.includes(map.id)) continue;
    const json = JSON.parse(readFileSync(join(dataDir, "course", `${COURSE}.json`), "utf8")) as CourseJson;
    const course = parseCourse(json, bytes(join(dataDir, "course", json.terrain.file)));
    const file = map.level ? await loadArenaFile(bytes(join(dataDir, "maps", `${map.level}.glb`)), course) : null;
    if (file) stampArena(course, map.centre, map.radius, file);
    const route = buildRoute(course);
    if (file) clearRoute(route, map.centre, map.radius);
    const world = await createPhysicsWorld();
    buildCoursePhysics(world, course, route);
    const spawns = file ? buildArenaStructures(world, file, null).spawns : undefined;
    const layout = layoutFor(map, course, route, spawns);
    if (layout.walled) buildArenaWall(world, course, map.centre, map.radius);
    world.step();
    out.set(map.id, { world, course, layout });
  }
  return out;
}
