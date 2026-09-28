#!/usr/bin/env node
// Bake a level's lighting into a lightmap JPEG (and lightmap UVs saved into the .blend).
// Usage: node tools/bake-lighting.mjs <level.blend> <out.jpg> [size=2048] [samples=128]
// Takes minutes. Re-run after moving geometry or lights; then export the level again.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBlender } from "./find-blender.mjs";

const [blend, out, size = "2048", samples = "128"] = process.argv.slice(2);
if (!blend || !out) {
  console.error("usage: bake-lighting.mjs <level.blend> <out.jpg> [size] [samples]");
  process.exit(2);
}
const script = join(dirname(fileURLToPath(import.meta.url)), "blender", "bake_lightmap.py");
const started = Date.now();
const result = spawnSync(
  findBlender(),
  ["-b", resolve(blend), "--python-exit-code", "1", "--python", script, "--", resolve(out), size, samples],
  { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" },
);
const lines = (result.stdout ?? "").split("\n").filter((l) => /^(baking|bake device|wrote)/.test(l));
for (const l of lines) console.log(l);
if (result.status !== 0) {
  process.stdout.write(result.stdout ?? "");
  console.error(`bake failed (exit ${result.status})`);
  process.exit(1);
}
console.log(`baked in ${Math.round((Date.now() - started) / 1000)} s`);
