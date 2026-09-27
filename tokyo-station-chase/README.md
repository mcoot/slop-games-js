# Tokyo Station Chase

A first-person chase through Tokyo Station with Source-style movement: stay ahead of
the chaser, collect enough yen, buy a Shinkansen ticket on a realistic machine, get
through the gates and board a train.

Milestones: M0 movement sandbox → M1 Blender pipeline → M2 chaser → M3 core loop →
M4 Tokyo Station slice. **M0–M3 are done.**

## Running it

```sh
cd tokyo-station-chase
pnpm install
pnpm dev        # http://localhost:5173 (?level=station-open or ?level=sandbox for the others)
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
| E | Use (the ticket machines) |
| 1–9 / click, Esc | Ticket machine buttons; Esc cancels |
| R | Restart the round |

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
| `@slop/interaction` | Look-at-and-press: which interactable is in reach and in view |
| `@slop/ui-screens` | Screen UIs (machines, kiosks) as state machines, drawn as a DOM overlay with keyboard shortcuts |
| `tools/` | Headless Blender export (`export-levels.mjs`, `blender/export_gltf.py`) and the Vite plugin that hot-reloads levels |
| `games/tokyo-station` | The game: levels, the station round (`src/round/`: yen, fares, ticket machine, gates, train), HUD and wiring |

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
| Marker `type` = `patrol_point` | The chaser's calm patrol, walked in name order (`patrol-00`, `patrol-01`, ...) |
| Mesh `hide-<name>_col_trigger` | A hiding place: while you're in it and keeping still the director gives him no hints |
| Marker `type` = `chokepoint` | A place a fleeing player will probably pass (in M3: ticket machines, gates, platforms). The chaser lies in wait here when it has lost you |
| Marker `type` = `money_spawn` | Yen lying around. Custom property `value`: 1, 5, 10, 50, 100, 500, 1000, 5000 or 10000 |
| Marker `type` = `interact` | Something to use with E. Custom property `action`: `ticket_machine` |
| Marker `type` = `gate` | A ticket gate: on the floor in the middle of a passage (1.2 m wide), facing along it. The game adds the flaps |
| Marker `type` = `train_door` | A train door opening: on the floor, facing out. The game adds the doors, which shut at departure |
| Mesh `train-interior_col_trigger` | Inside the train: be in here with a valid ticket when the doors shut to win |
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
- **Starts calm.** He walks a patrol (`patrol_point` markers, in name order) at a
  stroll, unaware, until he sees or hears you. The director never helps him before
  that first contact, nor in the first 25 s of a round.
- **Sight.** 28 m. Close up he has a 120° field of view and reacts in 0.35 s; towards
  28 m that narrows to 70° and 0.8 s, so crossing a corridor far away isn't fatal.
  Blocked by geometry; within 2 m he notices you whatever way he faces. He stoops to
  look into low spaces.
- **Hearing.** Your movement makes noise events: running footsteps carry ~15 m,
  walking (Shift) and crouching almost nothing, jumps 8 m and landings more the harder
  you land (bunny-hop chains are loud). Walls muffle noise. Anything can emit noise
  through `NoiseBus`: the ticket machines beep (7 m) and print (10 m), gates chime.
- **Losing you.** When you break line of sight he runs to where you were going (last
  seen position plus velocity) and looks around, then spends 12 s combing that area
  at a brisk walk before the director gets involved.
- **Director.** After that, every 9 s he gets a new place to look, alternating between
  a fuzzy hint (a random reachable point within a radius of where you really are,
  shrinking from 45 m to 20 m the longer you stay hidden) and the chokepoint nearest
  you. While you're in a hiding place (`hide_col_trigger`) and keeping still he gets
  no hints at all.
- **Speed.** In sight 5.5 m/s (you run 6.0), so breaking line of sight around a corner
  opens a gap. Running to a fresh noise or last-seen spot 6.3 m/s; searching and
  following hints 4.5 m/s (a brisk walk); patrolling 2.2 m/s. More than 30 m away by
  path he speeds up x1.15. He never teleports.
- **Caught** within 0.9 m: game over, R to restart. He waits while the menu is open.

## The station round (M3)

`tokyo_station.blend`: a greybox Tokyo Station on two floors, laid out as a street grid
of shop blocks (6 north–south by 4 east–west streets, 4 m wide) so you're always a
corner away from breaking line of sight:

- **Concourse** (ground floor): you start at the south entrance. A central plaza with
  the exposed ticket machines (3), loops round the blocks, a dead end with the ¥5,000
  note, and the two gate lines in the north wall: 丸の内側 Marunouchi (west) and
  八重洲側 Yaesu (east).
- **B1, Gransta**: the same street grid with different closures and two more dead ends.
  The quiet machines (2) are in a passage through a block in the far south-east.
  The chaser starts here, patrolling.
- **Stairs**: three stairwells join the floors. At the bottom end of each, the
  concourse drops 5 m into the stairwell: a one-way escape he has to go round for.
- **Player-only routes**: counters you can only crawl under (two on the concourse, one
  in B1), and a low kiosk near the spawn you can hop onto from a crate and cross.
  A ¥1,000 sits in each. Walkable yen alone (¥12,000) doesn't cover the fare, so
  you'll need at least one.
- **Hiding places**: three toilet alcoves (`hide-*` triggers).
- **Platform**: through either gate line into the paid hall, then either of two flights
  up to track 14.

The previous open-plan station is still there as `?level=station-open`.

- You have 5 minutes (station clock 14:27 → departs 14:32, tunable in "Round"). Yen
  (¥16,000 in all) lies around both floors; the Kyoto fare is ¥12,650 unreserved, so
  you need most of it. A scripted near-perfect run with no chaser takes about 190 s. Coins
  jingle as you pick them up (the chaser can hear that).
- **Ticket machine** (JR Central Tōkaidō style, Japanese and English): destination →
  seat type (unreserved / reserved +¥1,090) → passengers → pay by feeding in coins and
  notes one at a time → ticket and change as coins and notes. Like real machines it
  won't take ¥1 or ¥5 coins. Every screen takes a moment and every press beeps; the
  printer is loud. The world keeps running while you're at the machine.
  Fares are plausible, not real.
- **Gates** open for anyone with a ticket (and silently for the chaser) and chime and
  stay shut without one. They can't be jumped.
- **Train**: board with a valid ticket (right destination) and the doors close 3 s later;
  be inside when they shut to win. Without one the conductor stops you. At departure the
  doors shut regardless.
- Lose if the salaryman catches you or the train leaves. The machines, the gates and the
  platform stairs are his chokepoints.

## Test room

`movement_sandbox.blend` has stairs (17 cm station stairs, then 20 cm escalator-like steps), ramps at 15°/30°/44°
(walkable) and 50° (too steep, you slide), jump boxes from 0.5 to 2.1 m (1.3 m needs a
crouch-jump, 1.7 m is out of reach), gap jumps from 2 to 6 m, a 1.25 m crouch tunnel,
a low-ceiling pillar hall and a long runway with 10 m markers for bunny-hopping.

## Known limits

- The bundle is ~5 MB (1.8 MB gzipped), mostly Rapier's inlined WASM. Fine for now;
  switch to the non-compat Rapier build if load time matters.
- No ladders, water or surf yet.
- Gate vaulting (planned) isn't in yet: the gates can't be climbed.
- Tuning step height, slope or hull size doesn't rebuild the chaser's navmesh (saving
  the level does).
- Recast adds ~730 kB (220 kB gzipped) to the bundle.
- Nothing checks that the committed .glb is up to date with its .blend. Saving with
  `pnpm dev` running keeps it in sync; otherwise run `pnpm export-levels`.
