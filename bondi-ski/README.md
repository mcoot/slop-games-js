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

### Multiplayer

Peer to peer, with no server of our own. On the title card, "Create a race room" puts a
room code in the page's link (`?room=...`); anyone who opens the link joins. Press Enter
in game and everyone in the room lines up at the start, counts down together and races;
other skiers are drawn with name tags, live standings sit top right, and the finish card
shows everyone's results. R leaves the race. Race times don't count towards your solo
best or ghost.

| File | What it does |
| --- | --- |
| `src/net/protocol.ts` | The messages: hello (name, colour), positions (20 a second), countdown, gates, finish, ping |
| `src/net/session.ts` | `RaceSession`: who's here, the shared countdown (allowing for message delay), interpolating other racers 120 ms behind, standings |
| `src/net/transport.ts`, `src/net/trystero.ts`, `src/net/connect.ts` | Connections. Over the internet: WebRTC data channels, with the handshake through public Nostr relays via [Trystero](https://github.com/dmotz/trystero) (MIT). `?net=local` connects only tabs in this browser, for testing offline |
| `src/net/multiplayer.ts` | The game side: lobby controls, racer figures, countdown and standings |

Movement stays client-side (no authority), which is fine for friendly races. A tab in the
background pauses the game, so its skier freezes (and misses "go") until you come back.
Some strict networks block WebRTC between peers; a TURN relay would fix that if it comes up.
