// Draws a top-down map of a built course (surfaces, height shading, buildings, the walk
// and checkpoints) to a PNG, for checking the data without starting the game.
//
//   node tools/preview-course.mjs [course name] [out.png]
import { PNG } from "pngjs";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2] ?? "icebergs-tamarama";
const outFile = process.argv[3] ?? `${name}.png`;
const course = JSON.parse(readFileSync(join(root, "public", "course", `${name}.json`), "utf8"));
const bin = readFileSync(join(root, "public", "course", course.terrain.file));
const { cols, rows, x0, z0, cell } = course.terrain;
const SCALE = 3;
const png = new PNG({ width: cols * SCALE, height: rows * SCALE });
// urban, grass, sand, rock, sea, road, path, scrub
const colours = [[190, 180, 165], [110, 170, 90], [235, 215, 160], [200, 130, 70], [40, 110, 170], [90, 90, 95], [230, 230, 225], [80, 120, 70]];
for (let r = 0; r < rows * SCALE; r++) {
  for (let c = 0; c < cols * SCALE; c++) {
    const i = Math.floor(r / SCALE) * cols + Math.floor(c / SCALE);
    const h = bin.readInt16LE(i * 2) / 10;
    const [cr, cg, cb] = colours[bin[cols * rows * 2 + i]];
    const k = Math.max(0.4, Math.min(1.3, 0.6 + h / 50));
    const o = (r * cols * SCALE + c) * 4;
    png.data[o] = cr * k;
    png.data[o + 1] = cg * k;
    png.data[o + 2] = cb * k;
    png.data[o + 3] = 255;
  }
}
function dot(x, z, [cr, cg, cb], radius) {
  const c = Math.round(((x - x0) / cell) * SCALE);
  const r = Math.round(((z - z0) / cell) * SCALE);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (c + dx < 0 || c + dx >= cols * SCALE || r + dy < 0 || r + dy >= rows * SCALE) continue;
      const o = ((r + dy) * cols * SCALE + c + dx) * 4;
      png.data[o] = cr;
      png.data[o + 1] = cg;
      png.data[o + 2] = cb;
    }
  }
}
for (const b of course.buildings) for (const [x, z] of b.footprint) dot(x, z, [120, 60, 60], 1);
for (const [x, , z] of course.trees) dot(x, z, [30, 80, 30], 1);
for (const [x, , z] of course.path) dot(x, z, [255, 40, 40], 1);
for (const cp of course.checkpoints) dot(course.path[cp.index][0], course.path[cp.index][2], [255, 255, 0], 5);
writeFileSync(outFile, PNG.sync.write(png));
console.log(`wrote ${outFile}`);
