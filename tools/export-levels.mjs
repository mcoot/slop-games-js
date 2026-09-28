#!/usr/bin/env node
// Export every .blend in a folder to .glb with Blender, headless.
// Usage: node tools/export-levels.mjs <src-dir> <out-dir>
import { readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { exportBlend } from "./blender-export.mjs";

const [srcDir, outDir] = process.argv.slice(2).map((p) => resolve(p));
if (!srcDir || !outDir) {
  console.error("usage: export-levels.mjs <src-dir> <out-dir>");
  process.exit(2);
}

const files = readdirSync(srcDir).filter((f) => f.endsWith(".blend"));
if (files.length === 0) console.warn(`no .blend files in ${srcDir}`);
for (const file of files) {
  const out = join(outDir, `${basename(file, ".blend")}.glb`);
  try {
    await exportBlend(join(srcDir, file), out);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  console.log(`${file} -> ${out}`);
}
