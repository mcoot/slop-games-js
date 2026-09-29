# Bondi Ski

Tribes on the Sydney coast: **deathmatch** in walled arenas on the real coast (the
default), plus a skiing **time trial and races** (`?mode=race`). The course is **Icebergs
to Tamarama** (about 1.06 km of the real walk, round Marks
Park and Mackenzies Point). You ski the real terrain: the ground, sea, walk, buildings
and trees come from OpenStreetMap and Geoscience Australia elevation data (see
[`data/SOURCES.md`](data/SOURCES.md)), with a gate at each landmark.

## Deathmatch

### Maps

Pick one on the title card, or with `?map=` (a room's invite link carries its map):

| Map | `?map=` | What it is |
| --- | --- | --- |
| Marks Park (default) | `marks-park` | The grassy headland between Bondi and Tamarama, 115 m across the wall's radius: a 30 m hill, cliffs and the walk's railings round the edge |
| Bondi Beach | `bondi-beach` | The south end of the beach, 150 m radius: the park bank down to the promenade, the sand and the surf |
| Coastal walk | `coastal-walk` | The whole course, open, 420 m from the middle before the edge hurts |

The arenas are Tribes: Ascend style: a circle of the real coast inside a force-field
wall, with the rest of Bondi as the backdrop. The wall is solid to players and discs
alike, nearly invisible from across the arena, and lights up as you get close. The
sea still kills inside it. Maps are data in `src/maps.ts` (centre, radius, walled);
spawns are worked out on dry land clear of buildings (`layoutFor`), and the wall's
colliders and look are in `src/course/physics.ts` and `src/view/forceField.ts`.

Everyone keeps the skiing and jetpack, and carries two weapons and three impact grenades modelled on Tribes:
Ascend (every number is in the Tuning panel):

| | Spinfusor (1) | Assault rifle (2) | Impact Nitron (F) |
| --- | --- | --- | --- |
| Projectile | Disc, 62 m/s, keeps 50% of your velocity | Round, 230 m/s, keeps 30% | Grenade, 30 m/s thrown in an arc, keeps 50%, bursts on impact |
| Damage | 700 on a direct hit or within 2 m of the blast, then down to 25% at 7 m | 80 a round, no splash | 450 within 1.5 m, down to 30% at 8 m |
| Midair | ×1.1 on a direct hit against someone in the air: 770, nearly a kill from full health | none | none |
| Rate | one disc every 1.1 s | three-round bursts (0.075 s apart), 0.3 s between bursts; 24-round magazine, 1.7 s reload | one every 0.8 s; 3 per life, restocked when you respawn |
| Self | 35% of the damage, 1.5× knockback: disc jumps build speed | none | 35%, 1.5× knockback |

Switching weapons takes 0.4 s before the new one can fire, and a weapon you've put away
reloads itself after 3 s.

900 health, back 60 hp/s after 8 s without damage; 3 s to respawn, at a spawn point
along the course away from everyone. First to 15 kills wins; the scores show for 10 s,
then a new match starts. Getting past an arena's wall (over the top), or 420 m from the
middle of the coastal walk, hurts; the sea kills.

Enemies you can see have their name and a health bar over them, and your hits float
up as damage numbers (yellow for a midair, red for the kill).

On your own you play practice bots (3 by default; Tuning → Match). They're simple:
they head for the nearest enemy, ski and jet on the way, strafe and hop up close, and
fire discs at your feet with a rough lead. In a room (title card → Create a room, then
share the link) it's players only.

| Key | Action |
| --- | --- |
| Left mouse | Fire |
| 1 / 2 / Q / wheel | Spinfusor / assault rifle / swap |
| R | Reload |
| F | Throw an impact grenade |
| Tab | Scores |

### How the fighting works

| File | What it does |
| --- | --- |
| `src/combat/weapons.ts` | Weapon definitions and `WeaponState` (cooldowns, bursts, ammo, reloads) |
| `src/combat/damage.ts` | Blast damage with falloff, the midair bonus, self-damage and knockback; projectile vs capsule |
| `src/combat/projectiles.ts` | Projectiles in flight: they stop at the world (a ray cast past players' hulls) or a fighter |
| `src/combat/fighter.ts`, `match.ts` | Health, regen, death and respawn; kills and the kill target |
| `src/combat/arena.ts` | The fight without drawing: projectiles, damage to our fighters, spawns, the arena edge and the sea |
| `src/combat/bot.ts` | Practice bots |
| `src/net/combat.ts` | `CombatSession`: positions, shots, damage and deaths between players |
| `src/dm/` | The game side: HUD, kill feed, scores, rooms; `src/view/combat.ts` draws projectiles, blasts, fighters and your weapon |

Netcode: every client simulates every projectile from the shots it's told about
(fast-forwarded by half the round trip), and **each player judges their own damage**:
if a disc missed you on your screen, it missed. You then tell the room how much you
took and whether you died; everyone counts kills from those reports, so the scores
agree. The shooter gets hit markers from the victim's report. There's no server, so
a player could cheat; fine among friends.

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

## The time trial and races (`?mode=race`)

| Key | Action |
| --- | --- |
| WASD | Run; while skiing or flying, steer |
| Space | Tap to jump, hold to ski |
| Right mouse / Shift | Jetpack: uses energy, which recharges when you let go |
| C / Ctrl | Crouch |
| R | Restart the run |
| F | Back to the last gate |
| G | Show or hide your best run's ghost |
| M | Sound on/off (also a button on the title card; remembered) |
| Esc | Release the mouse; Tuning panel top right |

Skiing drops all ground friction: downhills turn into speed, momentum carries you up
the next rise, and you take off over crests. Land on a downslope and you keep your
speed. Running is only for getting going; the jetpack gets you up climbs or over
railings. The clock starts at the start gate and stops at Tamarama. You have to go through each
gate's arch, in order: go through a later one and you're told which you missed. A beam
of light marks the next gate. Landing in the sea puts you
back at the last gate. Your best time, its splits and a ghost of the run are kept in
this browser.

## How it works

| File | What it does |
| --- | --- |
| `tools/fetch-data.mjs`, `tools/area.mjs` | Download OSM features (Overpass) and Terrarium elevation tiles for the area; the local metre frame |
| `tools/build-course.mjs` | Terrain grid (3 m, bicubic from the ~4 m DEM) with surface classes painted from OSM, the sea shelved off the coastline, rock shelves where OSM maps rock past the waterline, coastal heath, the walk routed along OSM footpaths preferring the named coastal walk, the ground smoothed for ~40 m around it and the walk carved flat, checkpoints at landmarks, buildings, trees and props. The map runs north to take in Bondi Beach |
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
