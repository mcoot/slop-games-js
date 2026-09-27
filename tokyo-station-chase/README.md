# Tokyo Station Chase

A first-person chase through Tokyo Station with Source-style movement: stay ahead of
the chaser, collect enough yen, buy a Shinkansen ticket on a realistic machine, get
through the gates and board a train.

Milestones: M0 movement sandbox → M1 Blender pipeline → M2 chaser → M3 core loop →
M4 Tokyo Station slice. **This is M0.**

## Running it

```sh
cd tokyo-station-chase
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # headless movement tests (Rapier runs in Node)
pnpm typecheck
pnpm build      # static site in games/tokyo-station/dist
```

Click to capture the mouse. Esc releases it and opens the **Tuning** panel
(top right). Tuning changes apply live; "Save in this browser" keeps them, and
"Export JSON" lets you share a preset.

| Key | Action |
| --- | --- |
| WASD | Move |
| Space / mouse wheel | Jump (the wheel is how you bunny-hop) |
| C / Left Ctrl | Crouch (crouch in the air, or together with jump, to crouch-jump) |
| Shift | Walk |
| R | Back to spawn |

## Layout

Everything under `packages/` is game-agnostic and meant to be reused by later games;
only `games/tokyo-station` knows about Tokyo, yen or trains.

| Package | What it does |
| --- | --- |
| `@slop/core` | Fixed-timestep loop with render interpolation, frame stats |
| `@slop/input` | Action bindings (press counting, so wheel-jumps between ticks aren't lost), pointer-lock mouse look with raw input and Source sensitivity units |
| `@slop/physics` | Rapier (WASM) setup; static colliders from three.js meshes (boxes become cuboids, everything else a trimesh) |
| `@slop/fps-controller` | Source movement: friction, accelerate, air-accelerate, jumping, crouching and crouch-jumping, StepMove (stairs and ramps at full speed), StayOnGround, velocity clipping. Plus the camera rig (FOV in Source 4:3 terms, stair smoothing, landing dip, optional head bob) |
| `@slop/tuning` | lil-gui tuning panel with presets, browser save and JSON import/export |
| `games/tokyo-station` | The game. For now: the greybox movement sandbox, HUD and wiring |

## Conventions

- 1 unit = 1 metre, Y up, the player faces -Z at yaw 0. Source values convert at
  1 Hammer unit = 2.54 cm (`SOURCE_UNIT`), so a 72-unit hull is 1.83 m.
- Simulation runs at a fixed 66.67 Hz (Source's default tick) and rendering
  interpolates between ticks, so movement is identical at 60 Hz and 240 Hz.
  Mouse look is applied every rendered frame, never quantised to ticks.
- Movement numbers live in `MovementSettings` (`packages/fps-controller/src/settings.ts`).
  "Tokyo default" is the starting feel; CS:S-like and HL2-like presets are there to compare.

## Test room

Stairs (17 cm station stairs, then 20 cm escalator-like steps), ramps at 15°/30°/44°
(walkable) and 50° (too steep, you slide), jump boxes from 0.5 to 2.1 m (1.3 m needs a
crouch-jump, 1.7 m is out of reach), gap jumps from 2 to 6 m, a 1.25 m crouch tunnel,
a low-ceiling pillar hall and a long runway with 10 m markers for bunny-hopping.

## Known limits

- The bundle is ~5 MB (1.8 MB gzipped), mostly Rapier's inlined WASM. Fine for now;
  switch to the non-compat Rapier build if load time matters.
- No ladders, water or surf yet.
