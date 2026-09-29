import * as THREE from "three";
import { FixedLoop, FrameStats } from "@slop/core";
import { ActionInput, MouseLook, attachDomInput } from "@slop/input";
import { createPhysicsWorld } from "@slop/physics";
import {
  FpsCameraRig,
  PlayerController,
  SOURCE_UNIT,
  defaultCameraFeel,
  yawBasis,
  type MoveCommand,
  type MovementSettings,
} from "@slop/fps-controller";
import { TuningPanel, type FieldSpec } from "@slop/tuning";
import { inSea, loadCourse, terrainNormal } from "./course/data";
import { buildRoute, defaultRoute } from "./course/route";
import { buildArenaWall, buildCoursePhysics, wallSpan } from "./course/physics";
import { buildArenaStructures, clearRoute, loadArenaFile, stampArena } from "./course/arenaLevel";
import { layoutFor, mapById, MAPS } from "./maps";
import { ForceField } from "./view/forceField";
import { bondiMovementPresets, bondiSkiMovement } from "./movement";
import { Jetpack } from "./jetpack";
import { RaceTracker, formatDelta, formatTime } from "./race/race";
import { GhostRecorder, clearBest, loadBest, saveBest, type BestRun } from "./race/ghost";
import { buildCourseView } from "./view/course";
import { createSky } from "./view/sky";
import { GpuTimer } from "./view/gpuTimer";
import { createWater } from "./view/water";
import { RacerView } from "./view/racer";
import { CoastAudio } from "./audio";
import { Multiplayer } from "./net/multiplayer";
import { Deathmatch } from "./dm/deathmatch";
import { WEAPONS, type WeaponDef } from "./combat/weapons";

/** Deathmatch by default; the time trial and races with `?mode=race`. */
const MODE: "dm" | "race" = new URLSearchParams(location.search).get("mode") === "race" ? "race" : "dm";
document.body.dataset.mode = MODE;
/** The deathmatch map, from `?map=` (the arena on Marks Park by default). */
const MAP = mapById(new URLSearchParams(location.search).get("map"));
import "./style.css";

type Action =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "jump"
  | "jet"
  | "crouch"
  | "restart"
  | "checkpoint"
  | "ghost"
  | "start"
  | "mute"
  | "fire"
  | "weapon1"
  | "weapon2"
  | "swap"
  | "scores";

const bindings: Record<Action, string[]> = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  // Tap to jump, hold to ski.
  jump: ["Space"],
  jet: ["Mouse2", "ShiftLeft"],
  crouch: ["KeyC", "ControlLeft"],
  restart: ["KeyR"],
  checkpoint: ["KeyF"],
  ghost: ["KeyG"],
  start: ["Enter", "NumpadEnter"],
  mute: ["KeyM"],
  // Deathmatch.
  fire: ["Mouse0"],
  weapon1: ["Digit1"],
  weapon2: ["Digit2"],
  swap: ["KeyQ", "WheelUp", "WheelDown"],
  scores: ["Tab"],
};

const COURSE = "icebergs-tamarama";

async function main() {
  const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  const display = { renderScale: 1 };
  const applyPixelRatio = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * display.renderScale);
  applyPixelRatio();
  const gpuTimer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const course = await loadCourse("course/", COURSE);
  // A map built in Blender replaces the ground inside its wall (deathmatch only).
  const arenaFile = MODE === "dm" && MAP.level ? await loadArenaFile(`maps/${MAP.level}.glb`, course) : null;
  if (arenaFile) stampArena(course, MAP.centre, MAP.radius, arenaFile);
  document.querySelector(".map-title")!.textContent = MAP.title;
  // Other maps reload the page onto them (a room link carries its map along).
  const mapsEl = document.querySelector<HTMLElement>(".maps")!;
  mapsEl.append(`${MAP.blurb} Maps: `);
  MAPS.forEach((m, i) => {
    if (i > 0) mapsEl.append(" · ");
    if (m === MAP) {
      const b = document.createElement("b");
      b.textContent = m.title;
      mapsEl.append(b);
    } else {
      const a = document.createElement("a");
      a.href = `?map=${m.id}`;
      a.textContent = m.title;
      mapsEl.append(a);
    }
  });
  document.querySelector(".credits")!.textContent =
    `${course.attribution.join(" · ")}. Terrain, the walk, buildings and trees come from this data.`;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#cfe6f2", 250, 1500);
  const camera = new THREE.PerspectiveCamera(80, 1, 0.1, 5000);
  // Mid-afternoon sun over the city, behind you as you head south.
  const sunDir = new THREE.Vector3(-0.35, 0.72, -0.6).normalize();
  scene.add(createSky(sunDir));
  scene.add(new THREE.HemisphereLight("#cfe8ff", "#a88c5c", 1.0));
  const sun = new THREE.DirectionalLight("#fff1d6", 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -80;
  sc.right = sc.top = 80;
  sc.near = 1;
  sc.far = 600;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const water = createWater(course.terrain, sunDir);
  scene.add(water.mesh);

  const world = await createPhysicsWorld();
  const route = buildRoute(course, { ...defaultRoute });
  if (arenaFile) clearRoute(route, MAP.centre, MAP.radius);
  const physics = buildCoursePhysics(world, course, route);
  const view = buildCourseView(course, route);
  scene.add(view.root);
  let arenaSpawns;
  if (arenaFile) {
    // The sky, blurred, for the polished steel to reflect.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyScene = new THREE.Scene().add(createSky(sunDir));
    const environment = pmrem.fromScene(skyScene, 0.02, 0.1, 5000).texture;
    pmrem.dispose();
    const structures = buildArenaStructures(world, arenaFile, environment);
    scene.add(structures.root);
    arenaSpawns = structures.spawns;
  }
  const layout = layoutFor(MAP, course, route, arenaSpawns);
  let forceField: ForceField | null = null;
  if (MODE === "dm" && layout.walled) {
    buildArenaWall(world, course, MAP.centre, MAP.radius);
    const span = wallSpan(course, MAP.centre, MAP.radius);
    forceField = new ForceField(MAP.centre, MAP.radius, span.bottom, span.top);
    scene.add(forceField.mesh);
  }
  world.step();

  const movement: MovementSettings = { ...bondiSkiMovement };
  const cameraFeel = { ...defaultCameraFeel, sourceFov: 100, landingDip: true };
  const simulation = { tickRate: 66.67 };
  const race = new RaceTracker(route.gates);
  const debug = { fps: true, perf: false, ghost: true };

  const spawn = route.respawn(0);
  const player = new PlayerController(world, movement, spawn.position);
  // The heightfield's triangles can report edge normals that bleed speed at a ski's
  // pace: use the terrain's smooth normal instead.
  player.contactNormal = (n, point, collider) =>
    collider.handle === physics.terrain.handle ? terrainNormal(course.terrain, point.x, point.z) : n;
  const jet = new Jetpack();
  const rig = new FpsCameraRig(camera, cameraFeel);
  const look = new MouseLook(canvas);
  look.yaw = spawn.yaw;
  const input = new ActionInput<Action>(bindings);
  attachDomInput(input, canvas, () => look.isLocked);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  const audio = new CoastAudio();

  // Personal best and its ghost.
  const bestKey = COURSE;
  let best: BestRun | null = loadBest(bestKey);
  const recorder = new GhostRecorder();
  const ghost = new RacerView("#6fd3ff", movement.standHeight);
  ghost.addTo(scene);

  // ------------------------------------------------------------ HUD
  const timerEl = document.querySelector<HTMLElement>("#timer")!;
  const timeEl = timerEl.querySelector<HTMLElement>(".time")!;
  const deltaEl = timerEl.querySelector<HTMLElement>(".delta")!;
  const stageEl = document.querySelector<HTMLElement>("#stage")!;
  const bestEl = document.querySelector<HTMLElement>("#best")!;
  const speedEl = document.querySelector<HTMLElement>("#speed")!;
  const energyEl = document.querySelector<HTMLElement>("#energy .fill")!;
  const perfEl = document.querySelector<HTMLElement>("#perf")!;
  const fpsEl = document.querySelector<HTMLElement>("#fps")!;
  const toastEl = document.querySelector<HTMLElement>("#toast")!;
  const endEl = document.querySelector<HTMLElement>("#end")!;
  let toastUntil = 0;
  let deltaUntil = 0;
  const toast = (text: string, seconds = 2.5) => {
    toastEl.textContent = text;
    toastEl.style.opacity = "1";
    toastUntil = performance.now() + seconds * 1000;
  };
  const showDelta = (d: number | null) => {
    deltaEl.textContent = d === null ? "" : formatDelta(d);
    deltaEl.className = `delta ${d === null ? "" : d <= 0 ? "ahead" : "behind"}`;
    deltaEl.style.opacity = "1";
    deltaUntil = performance.now() + 3000;
  };
  const updateBest = () => {
    bestEl.textContent = best ? `best ${formatTime(best.time)}${debug.ghost ? "  ·  ghost on (G)" : ""}` : "";
  };
  const updateGates = () => {
    view.gates.forEach((g, i) => g.setState(i < race.next ? "passed" : i === race.next ? "next" : "ahead"));
    const next = route.gates[race.next];
    stageEl.textContent = next
      ? race.next === 0
        ? `Start: through the gate  ·  ${Math.round(course.length)} m to Tamarama`
        : `Gate ${race.next}/${route.gates.length - 1}  ·  ${next.name}`
      : "Finished";
  };

  const showEnd = (time: number, pb: boolean, previous: BestRun | null) => {
    endEl.querySelector(".time")!.innerHTML =
      `${formatTime(time)}<small>${pb ? (previous ? `New best, ${formatDelta(time - previous.time)}` : "First run: that's your best") : `Best ${formatTime(previous!.time)} (${formatDelta(time - previous!.time)})`}</small>`;
    const rows = route.gates.slice(1).map((g, i) => {
      const t = race.splits[i + 1]!;
      const ref = previous?.splits[i + 1];
      const d = ref === undefined ? "" : `<td class="${t - ref <= 0 ? "ahead" : "behind"}">${formatDelta(t - ref)}</td>`;
      return `<tr><td>${g.name}</td><td>${formatTime(t)}</td>${d}</tr>`;
    });
    endEl.querySelector(".splits")!.innerHTML = rows.join("");
    endEl.querySelector(".field")!.innerHTML = mp.resultsHtml(me());
    endEl.querySelector(".again")!.textContent = mp.session ? "In a race room: Enter starts a race" : "";
    endEl.hidden = false;
  };
  const me = () => ({ x: player.feet.x, y: player.feet.y, z: player.feet.z, yaw: look.yaw, time: race.time, next: race.next });

  // ------------------------------------------------------------ multiplayer
  let lineUp: ReturnType<typeof route.respawn> | null = null;
  const mp = new Multiplayer(scene, movement.standHeight, (x, z) => route.samples[route.nearestSample(x, z)]!.s, {
    countdown(slot) {
      // Everyone to the start line, side by side, held until "go".
      restartSolo();
      const at = route.respawn(0);
      const s0 = route.samples[0]!;
      const side = (slot % 2 === 0 ? 1 : -1) * Math.ceil(slot / 2) * 1.6;
      at.position.x += s0.rx * side;
      at.position.z += s0.rz * side;
      lineUp = at;
      place(at);
      toast("Race starting", 1.5);
    },
    go() {
      lineUp = null;
      race.startNow();
      recorder.reset();
      updateGates();
      toast("Go!", 1);
    },
  }, MODE === "race");

  const showRaceEnd = (time: number) => {
    endEl.querySelector(".time")!.innerHTML = `${formatTime(time)}<small>Race finished</small>`;
    endEl.querySelector(".splits")!.innerHTML = "";
    endEl.querySelector(".field")!.innerHTML = mp.resultsHtml(me());
    endEl.querySelector(".again")!.textContent = "Enter: race again once everyone's in · R: leave the race";
    endEl.hidden = false;
  };

  // ------------------------------------------------------------ run control
  const place = (at: { position: { x: number; y: number; z: number }; yaw: number; velocity: { x: number; y: number; z: number } }) => {
    player.teleport(at.position);
    player.velocity.x = at.velocity.x;
    player.velocity.y = at.velocity.y;
    player.velocity.z = at.velocity.z;
    look.yaw = at.yaw;
    look.pitch = 0;
  };
  const restart = () => {
    if (mp.racing) mp.session?.quitRace();
    race.reset();
    recorder.reset();
    ghost.clearTrail();
    jet.reset();
    endEl.hidden = true;
    place(route.respawn(0));
    topSpeed = 0;
    showDelta(null);
    updateGates();
  };
  /** Back to the start for a solo run, without leaving a multiplayer race. */
  function restartSolo() {
    race.reset();
    recorder.reset();
    ghost.clearTrail();
    jet.reset();
    endEl.hidden = true;
    place(route.respawn(0));
    topSpeed = 0;
    showDelta(null);
    updateGates();
  }
  const backToGate = (why: string) => {
    if (race.state === "finished") return;
    if (race.state === "ready") {
      restart();
      return;
    }
    place(route.respawn(race.lastGate));
    jet.reset();
    toast(`${why}: back to ${route.gates[race.lastGate]!.name}`);
  };

  // ------------------------------------------------------------ deathmatch
  const dm =
    MODE === "dm" ? new Deathmatch({ scene, camera, world, course, layout, player, jet, look, audio, movement, toast: (t, s) => toast(t, s) }) : null;
  if (dm) for (const g of view.gates) g.root.visible = false;

  // ------------------------------------------------------------ tuning
  const tuning = new TuningPanel("Tuning", "bondi-ski.tuning");
  tuning.addGroup("Movement", movement, {
    runSpeed: [1, 12, 0.05],
    accelerate: [1, 20, 0.1],
    airAccelerate: [0, 150, 0.5],
    airSpeedCap: [0.1, 10, 0.05],
    friction: [0, 12, 0.1],
    skiFriction: [0, 1, 0.005],
    gravity: [5, 40, 0.1],
    jumpSpeed: [2, 12, 0.05],
    maxWalkableSlopeDeg: [20, 70, 0.5],
  });
  tuning.addPresets("Movement", bondiMovementPresets);
  tuning.addGroup("Jetpack", jet.settings, {
    thrust: [0, 60, 0.5],
    maxRise: [0, 40, 0.5],
    forwardThrust: [0, 40, 0.5],
    maxForward: [0, 60, 0.5],
    drain: [0, 2, 0.01],
    recharge: [0, 2, 0.01],
  });
  if (dm) {
    const weapon: Partial<Record<keyof WeaponDef, FieldSpec>> = {
      speed: [10, 400, 1],
      inherit: [0, 1, 0.05],
      gravity: [0, 30, 0.5],
      damage: [0, 2000, 5],
      splashRadius: [0, 20, 0.25],
      splashInner: [0, 20, 0.25],
      splashFalloff: [0, 1, 0.05],
      midairBonus: [1, 3, 0.05],
      selfDamage: [0, 1, 0.05],
      impulse: [0, 40, 0.5],
      selfImpulse: [0, 4, 0.05],
      cooldown: [0.05, 3, 0.05],
      spread: [0, 0.1, 0.001],
    };
    tuning.addGroup("Spinfusor", WEAPONS.disc, weapon);
    tuning.addGroup("Assault rifle", WEAPONS.rifle, { ...weapon, burst: [1, 6, 1], burstInterval: [0.02, 0.3, 0.005], magazine: [0, 120, 1], reload: [0, 5, 0.1] });
    tuning.addGroup("Health & weapons", dm.fighter.settings, { maxHealth: [100, 3000, 10], regenDelay: [0, 30, 0.5], regenRate: [0, 500, 5], respawnTime: [0, 10, 0.5], switchTime: [0, 2, 0.05], stowedReload: [0, 15, 0.5] });
    const match = tuning.addGroup("Match", dm.settings, { killTarget: [1, 100, 1], resultsTime: [2, 30, 1] });
    const bots = { count: dm.settings.bots };
    match.add(bots, "count", 0, 8, 1).name("practice bots").onChange((n: number) => dm.setBots(n));
  }
  tuning.addGroup("Camera", cameraFeel, { sourceFov: [60, 130, 1], landingDip: true, headBob: [0, 0.08, 0.005] });
  tuning.addGroup("Mouse", look.settings, { sensitivity: [0.1, 10, 0.01], mYaw: true, mPitch: true, invertY: true });
  tuning.addGroup("Audio", audio.settings, { master: [0, 1, 0.01], ocean: [0, 1, 0.01], wind: [0, 1, 0.01] });
  tuning.addGroup("Simulation", simulation, { tickRate: [20, 144, 1] });
  tuning.addGroup("Display", display, { renderScale: [0.25, 1, 0.05] });
  tuning.addGroup("Debug", debug, { fps: true, perf: true, ghost: true });
  tuning.gui.add({ clear: () => { clearBest(bestKey); best = null; updateBest(); } }, "clear").name("Forget my best time");
  tuning.addPersistence();
  tuning.load();
  const applyTuning = () => {
    player.applySettings();
    loop.tickRate = simulation.tickRate;
    audio.apply();
    perfEl.hidden = !debug.perf;
    fpsEl.hidden = !debug.fps;
    applyPixelRatio();
    updateBest();
  };
  tuning.onChange(applyTuning);

  // ------------------------------------------------------------ loop
  const stats = new FrameStats();
  let topSpeed = 0;
  let skiing = false;
  let elapsed = 0;
  let fpsShownAt = 0;
  let drawCalls = 0;
  let drawTris = 0;
  let lastField = 0;
  let missedToastUntil = 0;
  let forceStartUntil = 0;
  const loop = new FixedLoop({
    tickRate: simulation.tickRate,
    tick(dt) {
      const restartPressed = input.consumePresses("restart") > 0;
      const checkpointPressed = input.consumePresses("checkpoint") > 0;
      if (!dm && restartPressed) restart();
      if (!dm && checkpointPressed) backToGate("Back");
      if (input.consumePresses("mute") > 0) setMuted(!audio.muted);
      if (input.consumePresses("ghost") > 0) {
        debug.ghost = !debug.ghost;
        updateBest();
      }
      if (input.consumePresses("start") > 0 && mp.session && mp.session.phase !== "countdown" && mp.session.phase !== "racing") {
        // Don't yank people off the course: wait for them, unless you press Enter twice.
        const force = performance.now() < forceStartUntil;
        const busy = mp.session.startRace(force);
        if (busy.length > 0) {
          forceStartUntil = performance.now() + 3000;
          toast(`Waiting for ${busy.join(", ")} to finish · Enter again to start anyway`, 3);
        }
      }
      const axis = (a: Action, b: Action) => (input.isDown(a) ? 1 : 0) - (input.isDown(b) ? 1 : 0);
      const from = { x: player.feet.x, y: player.feet.y, z: player.feet.z };
      const cmd: MoveCommand & { jet: boolean } = {
        forward: axis("forward", "back"),
        side: axis("right", "left"),
        jumpPresses: input.consumePresses("jump"),
        jumpHeld: input.isDown("jump"),
        ski: input.isDown("jump"),
        crouch: input.isDown("crouch"),
        walk: false,
        yaw: look.yaw,
        jet: input.isDown("jet"),
      };
      if (debugHooks.autopilot) {
        Object.assign(cmd, debugHooks.autopilot(player));
        look.yaw = cmd.yaw;
      }
      const { forward, right } = yawBasis(cmd.yaw);
      const wx = forward.x * cmd.forward + right.x * cmd.side;
      const wz = forward.z * cmd.forward + right.z * cmd.side;
      const wl = Math.hypot(wx, wz) || 1;
      if (lineUp && mp.frozen) {
        // On the line: look around, but no moving until "go".
        place({ ...lineUp, yaw: look.yaw });
        cmd.forward = cmd.side = cmd.jumpPresses = 0;
        cmd.jet = false;
      }
      if (dm && !dm.alive) {
        // Dead: no moving, jetting or shooting until you respawn.
        cmd.forward = cmd.side = cmd.jumpPresses = 0;
        cmd.jumpHeld = cmd.ski = cmd.crouch = cmd.jet = false;
      }
      jet.tick(player, cmd.jet, { x: wx / wl, y: 0, z: wz / wl }, dt);
      player.tick(cmd, dt);
      skiing = !!cmd.ski && player.grounded;
      if (player.events.landedSpeed > 6) audio.landing(player.events.landedSpeed / 25);

      if (dm) {
        const pick = input.consumePresses("weapon1") > 0 ? "disc" : input.consumePresses("weapon2") > 0 ? "rifle" : input.consumePresses("swap") > 0 ? "swap" : null;
        dm.tick(dt, { fire: input.isDown("fire"), weapon: pick, reload: restartPressed, scores: input.isDown("scores") });
        world.step();
        rig.afterTick(player);
        topSpeed = Math.max(topSpeed, player.horizontalSpeed);
        return;
      }

      for (const e of race.tick(dt, from, player.feet)) {
        if (e.kind === "missed") {
          if (performance.now() > missedToastUntil) {
            missedToastUntil = performance.now() + 3000;
            audio.missed();
            toast(`Missed gate ${e.gate} · ${route.gates[e.gate]!.name}: go back through it`, 3);
          }
          continue;
        }
        if (e.kind === "start") {
          recorder.reset();
          ghost.clearTrail();
          toast("Go!", 1);
        } else {
          audio.gate(e.kind === "finish");
          if (mp.racing) mp.session?.gate(e.gate, e.time, e.kind === "finish");
          const ref = mp.racing ? undefined : best?.splits[e.gate];
          showDelta(ref === undefined ? null : e.time - ref);
          if (e.kind === "finish") {
            recorder.record(e.time, player.feet.x, player.feet.y, player.feet.z, look.yaw, true);
            // Mass starts aren't comparable with solo runs through the start gate.
            const previous = mp.racing ? null : best;
            const pb = !mp.racing && (!previous || e.time < previous.time);
            if (pb) {
              best = { time: e.time, splits: [...race.splits], ghost: recorder.finish() };
              saveBest(bestKey, best);
            }
            audio.finish(pb);
            if (mp.racing) showRaceEnd(e.time);
            else showEnd(e.time, pb, previous);
            updateBest();
          } else {
            toast(route.gates[e.gate]!.name, 1.5);
          }
        }
        updateGates();
      }
      mp.tick(me());
      if (race.state === "running") recorder.record(race.time, player.feet.x, player.feet.y, player.feet.z, look.yaw);
      if (inSea(course.terrain, player.feet)) {
        audio.splash();
        backToGate("Into the drink");
      }
      world.step();
      rig.afterTick(player);
      topSpeed = Math.max(topSpeed, player.horizontalSpeed);
    },
    render(alpha, frameDt) {
      stats.push(frameDt);
      elapsed += frameDt;
      rig.update(player, alpha, look.yaw, look.pitch, frameDt);
      water.update(elapsed);
      forceField?.update(camera.position, elapsed);
      // Keep the shadowed area around the player.
      const p = camera.position;
      sun.target.position.set(p.x, p.y - 10, p.z);
      sun.position.copy(sun.target.position).addScaledVector(sunDir, 300);

      if (dm) dm.render(alpha, frameDt);
      mp.render(me());
      if (!endEl.hidden && mp.racing && performance.now() - lastField > 500) {
        lastField = performance.now();
        endEl.querySelector(".field")!.innerHTML = mp.resultsHtml(me());
      }
      ghost.visible = !dm && debug.ghost && best !== null && race.state !== "finished" && !mp.racing;
      if (ghost.visible && best) {
        const f = best.ghost.sample(race.state === "running" ? race.time : 0);
        if (f) ghost.update(f.x, f.y, f.z, f.yaw);
      }
      audio.update(player.horizontalSpeed, skiing, jet.active);

      timerEl.classList.toggle("ready", race.state === "ready");
      timeEl.textContent = formatTime(race.time);
      const now = performance.now();
      if (now > deltaUntil) deltaEl.style.opacity = "0";
      if (now > toastUntil) toastEl.style.opacity = "0";
      energyEl.style.width = `${Math.round(jet.energy * 100)}%`;
      energyEl.classList.toggle("low", jet.energy < 0.2);
      const hs = player.horizontalSpeed;
      const state = jet.active ? "jetting" : skiing ? "skiing" : player.grounded ? "ground" : "air";
      speedEl.innerHTML = `${hs.toFixed(1)} m/s<small>${Math.round(hs * 3.6)} km/h · top ${topSpeed.toFixed(1)} · ${state}</small>`;
      // Refresh a few times a second so the number is readable.
      if (debug.fps && now - fpsShownAt > 250) {
        fpsShownAt = now;
        fpsEl.textContent = `${Math.round(stats.fps)} fps`;
      }
      if (debug.perf) {
        const gpu = gpuTimer.supported ? `${gpuTimer.ms?.toFixed(1) ?? "…"} ms` : "n/a";
        perfEl.textContent = `${Math.round(stats.fps)} fps  avg ${stats.averageMs.toFixed(1)} ms  worst ${stats.worstMs.toFixed(1)} ms\n` +
          `cpu: sim ${loop.tickMs.toFixed(1)} ms (${loop.ticksLastFrame} ticks) · frame ${loop.renderMs.toFixed(1)} ms · gpu ${gpu}\n` +
          `tick ${loop.tickRate.toFixed(1)} Hz · mouse ${look.rawInput ? "raw" : "accelerated"} · ${drawCalls} draws · ${(drawTris / 1000).toFixed(0)}k tris · ${Math.round(hs / SOURCE_UNIT)} u/s`;
      }
      if (debug.perf) gpuTimer.begin();
      renderer.render(scene, camera);
      // The world pass's numbers (the weapon pass after it resets them).
      drawCalls = renderer.info.render.calls;
      drawTris = renderer.info.render.triangles;
      dm?.drawOverlay(renderer);
      if (debug.perf) gpuTimer.end();
    },
  });

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  // Sound on/off: M in game, or the button on the title card.
  const soundButton = document.querySelector<HTMLButtonElement>("#sound")!;
  const setMuted = (muted: boolean) => {
    audio.muted = muted;
    soundButton.textContent = muted ? "Sound: off" : "Sound: on";
    soundButton.setAttribute("aria-pressed", String(muted));
    if (look.isLocked) toast(muted ? "Sound off (M)" : "Sound on (M)", 1.2);
  };
  soundButton.addEventListener("click", (e) => {
    e.stopPropagation();
    setMuted(!audio.muted);
  });
  setMuted(audio.muted);

  const overlay = document.querySelector<HTMLElement>("#overlay")!;
  const resume = document.querySelector<HTMLElement>("#resume")!;
  overlay.addEventListener("click", () => {
    audio.unlock();
    void look.lock();
  });
  resume.addEventListener("click", () => void look.lock());
  look.onLockChanged((locked) => {
    if (locked) resume.hidden = true;
    overlay.hidden = locked;
    if (!locked) input.releaseAll();
  });
  window.addEventListener("beforeunload", (e) => {
    if (look.isLocked) e.preventDefault();
  });

  // Handy in the console while tuning. `autopilot` takes over the controls (tests use it).
  const debugHooks: { autopilot: ((p: PlayerController) => Partial<MoveCommand> & { jet?: boolean }) | null } = { autopilot: null };
  Object.assign(window, { bondi: { course, route, player, jet, race, world, look, camera, place, restart, mp, dm, hooks: debugHooks } });

  applyTuning();
  updateBest();
  if (!dm) restart();
  document.querySelector("#loading")?.remove();
  loop.start();
}

main().catch((err) => {
  console.error(err);
  const el = document.querySelector("#loading");
  if (el) el.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
