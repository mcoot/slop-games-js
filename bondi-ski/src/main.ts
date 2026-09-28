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
import { TuningPanel } from "@slop/tuning";
import { inSea, loadCourse, terrainNormal } from "./course/data";
import { buildRoute, defaultRoute } from "./course/route";
import { buildCoursePhysics } from "./course/physics";
import { bondiMovementPresets, bondiSkiMovement } from "./movement";
import { Jetpack } from "./jetpack";
import { RaceTracker, defaultRaceSettings, formatDelta, formatTime } from "./race/race";
import { GhostRecorder, clearBest, loadBest, saveBest, type BestRun } from "./race/ghost";
import { buildCourseView } from "./view/course";
import { createSky } from "./view/sky";
import { createWater } from "./view/water";
import { RacerView } from "./view/racer";
import { CoastAudio } from "./audio";
import { Multiplayer } from "./net/multiplayer";
import "./style.css";

type Action = "forward" | "back" | "left" | "right" | "jump" | "jet" | "crouch" | "restart" | "checkpoint" | "ghost" | "start";

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
};

const COURSE = "icebergs-tamarama";

async function main() {
  const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const course = await loadCourse("course/", COURSE);
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
  const physics = buildCoursePhysics(world, course, route);
  const view = buildCourseView(course, route);
  scene.add(view.root);
  world.step();

  const movement: MovementSettings = { ...bondiSkiMovement };
  const cameraFeel = { ...defaultCameraFeel, sourceFov: 100, landingDip: true };
  const simulation = { tickRate: 66.67 };
  const race = new RaceTracker(route.gates, { ...defaultRaceSettings });
  const debug = { perf: false, ghost: true };

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
  });

  const showRaceEnd = (time: number) => {
    endEl.querySelector(".time")!.innerHTML = `${formatTime(time)}<small>Race finished</small>`;
    endEl.querySelector(".splits")!.innerHTML = "";
    endEl.querySelector(".field")!.innerHTML = mp.resultsHtml(me());
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
  tuning.addGroup("Camera", cameraFeel, { sourceFov: [60, 130, 1], landingDip: true, headBob: [0, 0.08, 0.005] });
  tuning.addGroup("Mouse", look.settings, { sensitivity: [0.1, 10, 0.01], mYaw: true, mPitch: true, invertY: true });
  tuning.addGroup("Race", race.settings, { halfWidth: [5, 80, 1] });
  tuning.addGroup("Audio", audio.settings, { master: [0, 1, 0.01], ocean: [0, 1, 0.01], wind: [0, 1, 0.01] });
  tuning.addGroup("Simulation", simulation, { tickRate: [20, 144, 1] });
  tuning.addGroup("Debug", debug, { perf: true, ghost: true });
  tuning.gui.add({ clear: () => { clearBest(bestKey); best = null; updateBest(); } }, "clear").name("Forget my best time");
  tuning.addPersistence();
  tuning.load();
  const applyTuning = () => {
    player.applySettings();
    loop.tickRate = simulation.tickRate;
    audio.apply();
    perfEl.hidden = !debug.perf;
    updateBest();
  };
  tuning.onChange(applyTuning);

  // ------------------------------------------------------------ loop
  const stats = new FrameStats();
  let topSpeed = 0;
  let skiing = false;
  let elapsed = 0;
  let lastField = 0;
  const loop = new FixedLoop({
    tickRate: simulation.tickRate,
    tick(dt) {
      if (input.consumePresses("restart") > 0) restart();
      if (input.consumePresses("checkpoint") > 0) backToGate("Back");
      if (input.consumePresses("ghost") > 0) {
        debug.ghost = !debug.ghost;
        updateBest();
      }
      if (input.consumePresses("start") > 0 && mp.session && mp.session.phase !== "countdown" && mp.session.phase !== "racing") {
        mp.session.startRace();
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
      jet.tick(player, cmd.jet, { x: wx / wl, y: 0, z: wz / wl }, dt);
      player.tick(cmd, dt);
      skiing = !!cmd.ski && player.grounded;
      if (player.events.landedSpeed > 6) audio.landing(player.events.landedSpeed / 25);

      for (const e of race.tick(dt, from, player.feet)) {
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
      // Keep the shadowed area around the player.
      const p = camera.position;
      sun.target.position.set(p.x, p.y - 10, p.z);
      sun.position.copy(sun.target.position).addScaledVector(sunDir, 300);

      mp.render(me());
      if (!endEl.hidden && mp.racing && performance.now() - lastField > 500) {
        lastField = performance.now();
        endEl.querySelector(".field")!.innerHTML = mp.resultsHtml(me());
      }
      ghost.visible = debug.ghost && best !== null && race.state !== "finished" && !mp.racing;
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
      if (debug.perf) {
        perfEl.textContent = `${Math.round(stats.fps)} fps  avg ${stats.averageMs.toFixed(1)} ms  worst ${stats.worstMs.toFixed(1)} ms\n` +
          `tick ${loop.tickRate.toFixed(1)} Hz · mouse ${look.rawInput ? "raw" : "accelerated"} · ${renderer.info.render.calls} draws · ${Math.round(hs / SOURCE_UNIT)} u/s`;
      }
      renderer.render(scene, camera);
    },
  });

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

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
  Object.assign(window, { bondi: { course, route, player, jet, race, world, look, camera, place, restart, mp, hooks: debugHooks } });

  applyTuning();
  updateBest();
  restart();
  document.querySelector("#loading")?.remove();
  loop.start();
}

main().catch((err) => {
  console.error(err);
  const el = document.querySelector("#loading");
  if (el) el.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
