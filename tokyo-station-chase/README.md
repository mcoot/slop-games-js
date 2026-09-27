# Tokyo Station Chase

A first-person chase through Tokyo Station with Source-style movement: stay ahead of
the chaser, collect enough yen, buy a Shinkansen ticket on a realistic machine, get
through the gates and board a train.

Milestones: M0 movement sandbox → M1 Blender pipeline → M2 chaser → M3 core loop →
M4 Tokyo Station slice. **M0–M2 are done.**

## Running it

```sh
cd tokyo-station-chase
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # headless movement tests (Rapier runs in Node)
pnpm typecheck
pnpm build      # static site in games/tokyo-station/dist
pnpm export-levels  # re-export Blender levels to .glb (needs Blender, see "Levels")
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
| R | Restart: you and the chaser back to your spawns |

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
| `@slop/level-loader` | Loads a Blender-exported .glb as a level: meshes, colliders, markers (spawns etc.) and trigger volumes, from naming conventions (see "Levels"). Can dispose a level for hot reload |
| `@slop/ai` | Navmesh (Recast via recast-navigation-js), perception (sight, noise), search directors and the chaser. Game-agnostic: works with any level and `PlayerController` |
| `tools/` | Headless Blender export (`export-levels.mjs`, `blender/export_gltf.py`) and the Vite plugin that hot-reloads levels |
| `games/tokyo-station` | The game. For now: the greybox movement sandbox, HUD and wiring |

## Conventions

- 1 unit = 1 metre, Y up, the player faces -Z at yaw 0. Source values convert at
  1 Hammer unit = 2.54 cm (`SOURCE_UNIT`), so a 72-unit hull is 1.83 m.
- Simulation runs at a fixed 66.67 Hz (Source's default tick) and rendering
  interpolates between ticks, so movement is identical at 60 Hz and 240 Hz.
  Mouse look is applied every rendered frame, never quantised to ticks.
- Movement numbers live in `MovementSettings` (`packages/fps-controller/src/settings.ts`).
  "Tokyo default" is the starting feel; CS:S-like and HL2-like presets are there to compare.

## Levels

Levels are made in Blender (5.x) and exported to glTF binary (.glb), which the game
loads at runtime. Sources live in `games/tokyo-station/assets-src/levels/*.blend`;
`pnpm export-levels` writes `games/tokyo-station/public/levels/<name>.glb`. Both are
committed, so only people editing levels need Blender. The export script finds
Blender via `$BLENDER`, then `blender` on your PATH, then `/Applications/Blender.app`.

### Hot reload

While `pnpm dev` is running, just save the .blend in Blender. The dev server re-exports
it (about a second) and the open game swaps the level in place: no page reload, and
you keep your position and velocity (press R to go back to the spawn, which picks up
a moved `player_spawn`). Export errors show in the dev server's terminal and the
browser console. Running `pnpm export-levels` by hand also triggers a reload.

Before committing a level change, run `pnpm test` (the movement tests use the sandbox).

### Authoring conventions

Blender is Z-up; the game is Y-up. The exporter converts, so just model with Z up.
The player's forward at yaw 0 is Blender **+Y**. 1 Blender unit = 1 m.

| In Blender | In the game |
| --- | --- |
| Any mesh | Drawn and solid. A mesh that is exactly a box (like the default cube, with any location, rotation and scale) gets an exact box collider; anything else a triangle-mesh collider |
| Custom property `collider` = `box` / `mesh` / `none` | Overrides that choice. `none` makes a mesh decoration only |
| Mesh named `<anything>_col` | Collision only, not drawn. Put simple boxes under detailed art (and set `collider` = `none` on the art) |
| Mesh named `<name>_col_trigger` | Invisible trigger volume (a box, or the convex hull of any other shape). Never blocks the player; the HUD shows `zone <name>` while you're inside |
| Empty with custom property `type` | A marker. The loader returns markers grouped by type, each with a position and a facing (the empty's +Y axis) |
| Marker `type` = `player_spawn` | Where the player's feet start, facing the empty's +Y axis |
| Marker `type` = `chaser_spawn` | Where the chaser starts |
| Marker `type` = `chokepoint` | A place a fleeing player will probably pass (in M3: ticket machines, gates, platforms). The chaser lies in wait here when it has lost you |
| Other marker types | Planned: `money_spawn`, `interact`, `train_door` |
| Custom property `surface` | Greybox material for the mesh: `floor`, `wall`, `stairs`, `ramp`, `steep`, `platform` or `prop`. Meshes without it keep their Blender material (base colour etc. via glTF) |
| Empty with custom property `label` | A floating text label |

Custom properties are set in Object Properties → Custom Properties, on the object
(not the mesh data). Hidden objects are still exported.

Blender's duplicate suffix is ignored, so a copy named `pillar_col.001` is still a
collision mesh. three.js drops `.`, `:`, `/`, `[` and `]` from `Object3D.name` and turns
spaces into underscores (`jumpbox-0.5` becomes `jumpbox-05`); the Blender name is kept in
`userData.name`.

### The movement sandbox

`assets-src/levels/movement_sandbox.blend` is the test room below. The movement tests
run against its exported .glb and rely on its layout (stair positions, box heights,
the tunnel), so if you move things around, expect to update
`games/tokyo-station/test/movement.test.ts`.

## The chaser (M2)

A salaryman who must not be escaped for good, but who doesn't cheat. Everything below
is in the Tuning panel (groups "Chaser", "Chaser behaviour", "Chaser director",
"Player noise"); the HUD shows whether he's **unaware**, **searching** or **hunting**,
and how far away he is.

- **Body.** He walks with the same Source controller as you, on a navmesh built from
  the level's collision with your hull, step height and slope limit (rebuilt on level
  hot reload). He climbs stairs and ramps but can't jump or crouch, so gaps, tall boxes
  and crawlspaces shake him off. If he can see you but can't reach you, he waits at the
  nearest point he can reach.
- **Sight.** 45 m, 120° field of view, blocked by geometry; within 2 m he notices you
  whatever way he faces. He stoops to look into low spaces. A short reaction time
  before he commits when he wasn't already chasing.
- **Hearing.** Your movement makes noise events: running footsteps carry ~15 m,
  walking (Shift) and crouching almost nothing, jumps 8 m and landings more the harder
  you land (bunny-hop chains are loud). Walls muffle noise. Anything can emit noise
  through `NoiseBus` (ticket machines and gates will in M3).
- **Losing you.** When you break line of sight he heads to where you were going
  (last seen position plus velocity), looks around, then starts searching.
- **Director.** While searching he never goes cold: every 6 s he gets a new place to
  look, alternating between a fuzzy hint (a random reachable point within a radius of
  where you really are, shrinking from 40 m to 15 m the longer you stay hidden) and
  the chokepoint nearest you.
- **Speed.** In sight he's a little slower than your run (5.7 vs 6.0 m/s), so good
  movement opens a gap. Out of sight he's faster (6.6 m/s), and more than 30 m away by
  path he speeds up again (x1.3). He never teleports.
- **Caught** within 0.9 m: game over, R to restart. He waits while the menu is open.

## Test room

`movement_sandbox.blend` has stairs (17 cm station stairs, then 20 cm escalator-like steps), ramps at 15°/30°/44°
(walkable) and 50° (too steep, you slide), jump boxes from 0.5 to 2.1 m (1.3 m needs a
crouch-jump, 1.7 m is out of reach), gap jumps from 2 to 6 m, a 1.25 m crouch tunnel,
a low-ceiling pillar hall and a long runway with 10 m markers for bunny-hopping.

## Known limits

- The bundle is ~5 MB (1.8 MB gzipped), mostly Rapier's inlined WASM. Fine for now;
  switch to the non-compat Rapier build if load time matters.
- No ladders, water or surf yet.
- Tuning step height, slope or hull size doesn't rebuild the chaser's navmesh (saving
  the level does).
- Recast adds ~730 kB (220 kB gzipped) to the bundle.
- Nothing checks that the committed .glb is up to date with its .blend. Saving with
  `pnpm dev` running keeps it in sync; otherwise run `pnpm export-levels`.
