/**
 * M0 greybox: a test room for tuning movement. Pure data so tests can load it
 * without a browser. Units are metres, Y up, the player spawns facing -Z.
 *
 * The game now loads this level from Blender (assets-src/levels/movement_sandbox.blend,
 * exported to public/levels/movement_sandbox.glb). These definitions generated that
 * .blend (`pnpm generate-sandbox`) and remain as the `?level=code` fallback and the
 * reference for the parity test. Once the .blend is edited by hand, delete them.
 */
export type Surface = "floor" | "wall" | "stairs" | "ramp" | "steep" | "platform" | "prop";

export interface BoxDef {
  name: string;
  center: [number, number, number];
  size: [number, number, number];
  /** Rotation about X in degrees (used for ramps). */
  pitchDeg?: number;
  surface: Surface;
}

export interface SandboxLevel {
  spawn: { x: number; y: number; z: number };
  boxes: BoxDef[];
  labels: { text: string; position: [number, number, number] }[];
  /** Sensor volumes. Only the Blender level has them (the in-code fallback ignores them). */
  triggers: { name: string; center: [number, number, number]; size: [number, number, number] }[];
}

const boxes: BoxDef[] = [];
const labels: SandboxLevel["labels"] = [];
const triggers: SandboxLevel["triggers"] = [];
const box = (name: string, surface: Surface, center: BoxDef["center"], size: BoxDef["size"], pitchDeg?: number) =>
  boxes.push({ name, surface, center, size, pitchDeg });
const label = (text: string, x: number, y: number, z: number) => labels.push({ text, position: [x, y, z] });

// Floor and perimeter walls: x -60..60, z +20..-100.
box("floor", "floor", [0, -0.5, -40], [120, 1, 120]);
box("wall-n", "wall", [0, 3, -100.5], [122, 6, 1]);
box("wall-s", "wall", [0, 3, 20.5], [122, 6, 1]);
box("wall-e", "wall", [60.5, 3, -40], [1, 6, 120]);
box("wall-w", "wall", [-60.5, 3, -40], [1, 6, 120]);

// Stairs: a normal station flight (0.17 m rise, 0.30 m tread), a landing, then
// a steeper flight like a stopped escalator (0.20 / 0.40).
{
  const x = -20;
  let z = -8;
  let top = 0;
  label("Stairs 17 cm", x, 2.5, z + 1);
  for (let i = 0; i < 12; i++) {
    top += 0.17;
    box(`stairs-a-${i}`, "stairs", [x, top / 2, z - 0.15], [4, top, 0.3]);
    z -= 0.3;
  }
  box("stairs-landing", "platform", [x, top / 2, z - 3], [4, top, 6]);
  z -= 6;
  for (let i = 0; i < 10; i++) {
    top += 0.2;
    box(`stairs-b-${i}`, "stairs", [x, top / 2, z - 0.2], [4, top, 0.4]);
    z -= 0.4;
  }
  box("stairs-top", "platform", [x, top / 2, z - 4], [4, top, 8]);
  triggers.push({ name: "stairs-top", center: [x, top + 1, z - 4], size: [4, 2, 8] });
}

// Ramps rising 3 m towards -Z. 50° is past the walkable limit (45.6°) so you slide.
{
  const rise = 3;
  const thickness = 0.5;
  const angles = [15, 30, 44, 50];
  angles.forEach((deg, i) => {
    const x = 10 + i * 5;
    const t = (deg * Math.PI) / 180;
    const run = rise / Math.tan(t);
    const length = rise / Math.sin(t);
    const zStart = -8;
    // Midpoint of the top surface, then back off along the surface normal.
    const my = rise / 2 - (thickness / 2) * Math.cos(t);
    const mz = zStart - run / 2 - (thickness / 2) * Math.sin(t);
    box(`ramp-${deg}`, deg > 45.6 ? "steep" : "ramp", [x, my, mz], [4, thickness, length], deg);
    box(`ramp-${deg}-top`, "platform", [x, rise / 2, zStart - run - 2], [4, rise, 4]);
    label(`${deg}°`, x, 1, zStart + 1);
  });
}

// Jump boxes. With default tuning a standing jump clears ~1.0 m and a crouch-jump ~1.6 m.
[0.5, 0.9, 1.3, 1.7, 2.1].forEach((h, i) => {
  const x = -34 + i * 4;
  box(`jumpbox-${h}`, "prop", [x, h / 2, -32], [2, h, 2]);
  label(`${h} m`, x, h + 0.6, -32);
});

// Gap jumps between 1 m high platforms, gaps 2..6 m.
{
  const x = 0;
  let z = -34;
  box("gap-start", "platform", [x, 0.5, z - 2], [3, 1, 4]);
  z -= 4;
  for (const gap of [2, 3, 4, 5, 6]) {
    z -= gap;
    label(`${gap} m gap`, x, 2, z + gap / 2);
    box(`gap-after-${gap}`, "platform", [x, 0.5, z - 1.5], [3, 1, 3]);
    z -= 3;
  }
}

// Crouch tunnel: 1.25 m clearance, you only fit crouched (1.17 m hull).
{
  const x = 32;
  const z = -40;
  box("tunnel-left", "wall", [x - 1.2, 0.8, z], [0.4, 1.6, 8]);
  box("tunnel-right", "wall", [x + 1.2, 0.8, z], [0.4, 1.6, 8]);
  box("tunnel-roof", "wall", [x, 1.25 + 0.175, z], [2.8, 0.35, 8]);
  label("Crouch tunnel", x, 2.2, z + 4.5);
}

// Pillar hall with a low ceiling (2.6 m) to feel head bumps, like a station underpass.
{
  box("hall-ceiling", "wall", [-40, 2.6 + 0.25, -70], [24, 0.5, 30]);
  for (let px = -50; px <= -30; px += 6) {
    for (let pz = -58; pz >= -82; pz -= 6) {
      box(`pillar-${px}-${pz}`, "prop", [px, 1.3, pz], [0.8, 2.6, 0.8]);
    }
  }
  label("Low ceiling hall", -40, 3.6, -54);
}

// Bunny-hop runway markers every 10 m along the east side.
for (let z = 10; z >= -90; z -= 10) {
  box(`marker-${z}`, "prop", [55, 0.5, z], [0.3, 1, 0.3]);
}
label("Bhop runway", 50, 2, 12);

export const movementSandbox: SandboxLevel = {
  spawn: { x: 0, y: 0.05, z: 10 },
  boxes,
  labels,
  triggers,
};
