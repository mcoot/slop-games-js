import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/** Blender's executable: $BLENDER, then `blender` on PATH, then the default macOS install. Exits if none. */
export function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["blender"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim().split("\n")[0];
  const mac = "/Applications/Blender.app/Contents/MacOS/Blender";
  if (existsSync(mac)) return mac;
  console.error("Blender not found: install it or set BLENDER=/path/to/blender");
  process.exit(1);
}
