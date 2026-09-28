# Bondi Ski

A Tribes-style skiing time trial along the Bondi to Coogee coastal walk in Sydney. The
first course is **Icebergs to Tamarama** (about 1.06 km of the real walk, round Marks
Park and Mackenzies Point). You ski the real terrain: the ground, sea, walk, buildings
and trees come from OpenStreetMap and Geoscience Australia elevation data (see
[`data/SOURCES.md`](data/SOURCES.md)), with a gate at each landmark.

## Running it

```sh
pnpm install            # once, at the repo root
cd bondi-ski
pnpm dev                # http://localhost:5173
pnpm build              # static site in dist/
pnpm fetch-data         # re-download OSM and elevation for the area (needs network)
pnpm build-course       # rebuild public/course/ from data/
node tools/preview-course.mjs icebergs-tamarama map.png   # top-down map of the course data
```

Tests run from the repo root (`pnpm test`), including a scripted skier that has to get
from Icebergs to Tamarama without ending up in the sea.

## Playing

| Key | Action |
| --- | --- |
| WASD | Run; while skiing or flying, steer |
| Space | Tap to jump, hold to ski |
| Right mouse / Shift | Jetpack: uses energy, which recharges when you let go |
| C / Ctrl | Crouch |
| R | Restart the run |
| F | Back to the last gate |
| G | Show or hide your best run's ghost |
| Esc | Release the mouse; Tuning panel top right |

Skiing drops all ground friction: downhills turn into speed, momentum carries you up
the next rise, and you take off over crests. Land on a downslope and you keep your
speed. Running is only for getting going; the jetpack gets you up climbs or over
railings. The clock starts at the start gate and stops at Tamarama. Gates are wide
planes across the course, so you can take your own line. Landing in the sea puts you
back at the last gate. Your best time, its splits and a ghost of the run are kept in
this browser.

## How it works

| File | What it does |
| --- | --- |
| `tools/fetch-data.mjs`, `tools/area.mjs` | Download OSM features (Overpass) and Terrarium elevation tiles for the area; the local metre frame |
| `tools/build-course.mjs` | Terrain grid (4 m) with surface classes painted from OSM, the sea shelved off the coastline, the walk routed along OSM footpaths preferring the named coastal walk and carved flat into the terrain, checkpoints at landmarks, buildings, trees and props |
| `src/course/route.ts` | The race line: a smoothed centreline, the gates, respawn points, and railings wherever the ground drops away beside the walk |
| `src/course/physics.ts` | Rapier colliders: heightfield terrain, buildings, tree trunks, railings |
| `src/jetpack.ts` | Thrust and energy |
| `src/race/` | `RaceTracker` (gate crossings, splits, clock) and ghost recording/playback. Pure state, driven by positions, so remote racers can use it too |
| `src/view/` | Sky, the sea shader (depth from the terrain, foam at the shore), sandstone strata shader, the course scene, racer figures |
| `src/movement.ts` | This game's movement presets |

### Movement

Skiing is a mode of the shared Source-style controller (`@slop/fps-controller`,
`MoveCommand.ski`); Tokyo doesn't use it, so its feel is unchanged. While skiing on the
ground there's no friction and no running; gravity pulls you along the slope, you steer
with air control, and you aren't held to the ground over crests. Bondi's preset is a
bit lighter than Source (gravity 16 m/s²) with more air control. The jetpack sits on
top in this game.

Bondi also sets `PlayerController.contactNormal` so contacts with the terrain use its
smooth normal: the heightfield's triangle edges otherwise report normals that bleed
speed at skiing pace.

### Multiplayer (later)

Not built yet; the pieces are shaped for it. A peer-to-peer race would send each
player's position, yaw and race events a few times a second over WebRTC data channels
(the site is static, so signalling would go through a public broker such as a
Nostr/BitTorrent tracker via a library like Trystero, or a tiny signalling worker).
Remote players are drawn with the same `RacerView` as the ghost, and each client runs
a `RaceTracker` per racer from their snapshots. Movement stays client-side
(no server authority), which is fine for friendly races.
