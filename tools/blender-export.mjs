import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findBlender } from "./find-blender.mjs";

const exportScript = join(dirname(fileURLToPath(import.meta.url)), "blender", "export_gltf.py");

/** Export one .blend to .glb with headless Blender. Rejects with Blender's output if it fails. */
export function exportBlend(blendPath, glbPath) {
  return new Promise((resolve, reject) => {
    let blender;
    try {
      blender = findBlender();
    } catch (err) {
      reject(err);
      return;
    }
    mkdirSync(dirname(glbPath), { recursive: true });
    const child = spawn(blender, ["-b", blendPath, "--python-exit-code", "1", "--python", exportScript, "--", glbPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Blender failed exporting ${blendPath} (exit ${code})\n${output.trim().split("\n").slice(-20).join("\n")}`));
    });
  });
}
