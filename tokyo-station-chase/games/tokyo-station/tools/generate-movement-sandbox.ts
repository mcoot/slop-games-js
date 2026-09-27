// Regenerate assets-src/levels/movement_sandbox.blend from the box definitions in
// src/levels/movementSandbox.ts. This overwrites the .blend, so only run it while the
// code definitions are still the source of truth (see README, "Levels").
// Usage: pnpm generate-sandbox
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findBlender } from "../../../tools/find-blender.mjs";
import { movementSandbox } from "../src/levels/movementSandbox.ts";
import { surfaceColors } from "../src/levels/surfaces.ts";

const here = dirname(fileURLToPath(import.meta.url));
const json = join(mkdtempSync(join(tmpdir(), "sandbox-")), "movement_sandbox.json");
writeFileSync(json, JSON.stringify({ ...movementSandbox, surfaceColors }));
const out = join(here, "..", "assets-src", "levels", "movement_sandbox.blend");

const result = spawnSync(
  findBlender(),
  ["-b", "--factory-startup", "--python-exit-code", "1", "--python", join(here, "generate_movement_sandbox.py"), "--", json, out],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
