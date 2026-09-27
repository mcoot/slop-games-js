#!/usr/bin/env node
// Export every .blend in a folder to .glb with Blender, headless.
// Usage: node tools/export-levels.mjs <src-dir> <out-dir>
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findBlender } from "./find-blender.mjs";

const [srcDir, outDir] = process.argv.slice(2).map((p) => resolve(p));
if (!srcDir || !outDir) {
  console.error("usage: export-levels.mjs <src-dir> <out-dir>");
  process.exit(2);
}

const exportScript = join(dirname(fileURLToPath(import.meta.url)), "blender", "export_gltf.py");
const blender = findBlender();
mkdirSync(outDir, { recursive: true });

const files = readdirSync(srcDir).filter((f) => f.endsWith(".blend"));
if (files.length === 0) console.warn(`no .blend files in ${srcDir}`);
for (const file of files) {
  const out = join(outDir, `${basename(file, ".blend")}.glb`);
  const result = spawnSync(
    blender,
    ["-b", join(srcDir, file), "--python-exit-code", "1", "--python", exportScript, "--", out],
    { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" },
  );
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    console.error(`Blender failed exporting ${file}`);
    process.exit(1);
  }
  console.log(`${file} -> ${out}`);
}
