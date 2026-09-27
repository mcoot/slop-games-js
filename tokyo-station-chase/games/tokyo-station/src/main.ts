import * as THREE from "three";
import { FixedLoop, FrameStats } from "@slop/core";
import { ActionInput, MouseLook, attachDomInput } from "@slop/input";
import { createPhysicsWorld } from "@slop/physics";
import { disposeLevel, loadLevel, triggersAt, type Level } from "@slop/level-loader";
import {
  FpsCameraRig,
  PlayerController,
  SOURCE_UNIT,
  defaultCameraFeel,
  movementPresets,
  tokyoMovement,
  type MovementSettings,
} from "@slop/fps-controller";
import { TuningPanel } from "@slop/tuning";
import {
  Chaser,
  HintDirector,
  MovementNoise,
  Navigation,
  NoiseBus,
  initNavigation,
  type NavAgent,
} from "@slop/ai";
import { NavMeshHelper } from "@recast-navigation/three";
import { ChaserView } from "./chaserView";
import { surfaceColors, type Surface } from "./levels/surfaces";
import { gridMaterial } from "./gridMaterial";
import { createHud } from "./hud";
import "./style.css";

type Action = "forward" | "back" | "left" | "right" | "jump" | "crouch" | "walk" | "reset";

const bindings: Record<Action, string[]> = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  jump: ["Space", "WheelUp", "WheelDown"],
  crouch: ["KeyC", "ControlLeft"],
  walk: ["ShiftLeft"],
  reset: ["KeyR"],
};

/** Exported from assets-src/levels/movement_sandbox.blend by `pnpm export-levels`. */
const SANDBOX_URL = "levels/movement_sandbox.glb";

async function main() {
  const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc9d6e3);
  scene.fog = new THREE.Fog(0xc9d6e3, 60, 180);
  scene.add(new THREE.HemisphereLight(0xeef3ff, 0x6b6250, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(30, 50, 20);
  sun.target.position.set(0, 0, -40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 1, far: 160 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const camera = new THREE.PerspectiveCamera(74, 1, 0.05, 400);

  const world = await createPhysicsWorld();
  const materials = new Map<Surface, THREE.Material>();
  /** Greybox materials for `surface` meshes, and text sprites for `label` empties (added under the level root). */
  const dress = (level: Level) => {
    const labels: THREE.Sprite[] = [];
    level.root.traverse((obj) => {
      const surface = obj.userData.surface as Surface | undefined;
      if (obj instanceof THREE.Mesh && surface && surface in surfaceColors) {
        if (!materials.has(surface)) materials.set(surface, gridMaterial(surfaceColors[surface]));
        obj.material = materials.get(surface)!;
        obj.castShadow = surface !== "floor";
        obj.receiveShadow = true;
      }
      if (typeof obj.userData.label === "string") {
        labels.push(textSprite(obj.userData.label, obj.getWorldPosition(new THREE.Vector3()).toArray()));
      }
    });
    level.root.add(...labels);
    scene.add(level.root);
  };
  let level = await loadLevel(world, SANDBOX_URL);
  dress(level);
  world.step();

  // Settings objects are shared by reference with the tuning panel.
  const movement: MovementSettings = { ...tokyoMovement };
  const cameraFeel = { ...defaultCameraFeel };
  const simulation = { tickRate: 66.67 };
  const chase = { enabled: true, footstepVolume: 0.8, showNavmesh: false };

  const player = new PlayerController(world, movement, level.spawn.position);

  // The chaser walks the same navmesh rules as the player's hull.
  await initNavigation();
  const agent = (): NavAgent => ({
    radius: movement.hullHalfWidth,
    height: movement.standHeight,
    stepHeight: movement.stepHeight,
    maxSlopeDeg: movement.maxWalkableSlopeDeg,
  });
  let nav = Navigation.build(level.solids, agent());
  const director = new HintDirector();
  const chaserSpawn = () => level.markers.get("chaser_spawn")?.[0] ?? { position: { x: 0, y: 0, z: -40 }, yaw: 0 };
  const chokepoints = () => (level.markers.get("chokepoint") ?? []).map((m) => m.position);
  director.chokepoints = chokepoints();
  const chaser = new Chaser(world, nav, chaserSpawn(), { director, movement: { ...movement } });
  const chaserView = new ChaserView(movement.standHeight, movement.hullHalfWidth);
  scene.add(chaserView.root);
  const noise = new MovementNoise();
  const noises = new NoiseBus();
  let navHelper: NavMeshHelper | null = null;
  const updateNavHelper = () => {
    navHelper?.removeFromParent();
    navHelper = chase.showNavmesh ? new NavMeshHelper(nav.mesh) : null;
    if (navHelper) {
      navHelper.position.y = 0.02;
      scene.add(navHelper);
    }
  };
  let caught = false;
  const caughtScreen = document.querySelector<HTMLElement>("#caught")!;
  const newRound = () => {
    caught = false;
    caughtScreen.hidden = true;
    player.teleport(level.spawn.position);
    look.yaw = level.spawn.yaw;
    look.pitch = 0;
    topSpeed = 0;
    chaser.respawn(chaserSpawn());
  };
  const rig = new FpsCameraRig(camera, cameraFeel);
  const look = new MouseLook(canvas);
  look.yaw = level.spawn.yaw;
  const input = new ActionInput<Action>(bindings);
  attachDomInput(input, canvas, () => look.isLocked);

  const tuning = new TuningPanel("Tuning", "tokyo-station-chase.tuning");
  tuning.addGroup("Movement", movement, {
    runSpeed: [1, 12, 0.05],
    walkSpeed: [0.5, 8, 0.05],
    crouchSpeedFactor: [0.1, 1, 0.01],
    accelerate: [1, 20, 0.1],
    airAccelerate: [0, 150, 0.5],
    airSpeedCap: [0.1, 3, 0.01],
    friction: [0, 12, 0.1],
    stopSpeed: [0, 5, 0.05],
    gravity: [5, 40, 0.1],
    jumpSpeed: [2, 12, 0.05],
    autoBhop: true,
    bhopSpeedCap: [0, 3, 0.05],
    stepHeight: [0, 0.8, 0.01],
    maxWalkableSlopeDeg: [20, 70, 0.5],
    duckTime: [0, 0.6, 0.01],
  });
  tuning.addPresets("Movement", movementPresets);
  tuning.addGroup("Camera", cameraFeel, {
    sourceFov: [60, 130, 1],
    stepSmoothTime: [0, 0.3, 0.01],
    landingDip: true,
    headBob: [0, 0.08, 0.005],
  });
  tuning.addGroup("Mouse", look.settings, {
    sensitivity: [0.1, 10, 0.01],
    mYaw: true,
    mPitch: true,
    invertY: true,
  });
  tuning.addGroup("Chaser", chase, { enabled: true, footstepVolume: [0, 1, 0.05], showNavmesh: true });
  tuning.addGroup("Chaser behaviour", chaser.settings, {
    chaseSpeed: [1, 12, 0.05],
    searchSpeed: [1, 12, 0.05],
    catchUpDistance: [5, 100, 1],
    catchUpMultiplier: [1, 2.5, 0.05],
    sightRange: [5, 120, 1],
    fovDeg: [30, 240, 1],
    nearSense: [0, 6, 0.1],
    reactionTime: [0, 2, 0.05],
    loseSightGrace: [0, 3, 0.05],
    predictTime: [0, 3, 0.05],
    hearingThroughWalls: [0, 1, 0.05],
    lookAroundTime: [0, 8, 0.1],
    catchRadius: [0.4, 2, 0.05],
  });
  tuning.addGroup("Chaser director", director.settings, {
    interval: [1, 20, 0.5],
    radiusStart: [5, 100, 1],
    radiusMin: [0, 50, 1],
    shrinkRate: [0, 5, 0.05],
  });
  tuning.addGroup("Player noise", noise.settings, {
    runRadius: [0, 40, 0.5],
    walkRadius: [0, 20, 0.5],
    crouchRadius: [0, 20, 0.5],
    landingRadiusPerSpeed: [0, 10, 0.1],
    jumpRadius: [0, 40, 0.5],
    stride: [0.5, 4, 0.1],
  });
  tuning.addGroup("Simulation", simulation, { tickRate: [20, 144, 1] });
  tuning.addPersistence();
  tuning.load();
  const applyTuning = () => {
    player.applySettings();
    // The chaser moves by the player's rules (it sets its own run speed).
    Object.assign(chaser.body.settings, movement);
    chaser.body.applySettings();
    loop.tickRate = simulation.tickRate;
    updateNavHelper();
    chaserView.root.visible = chase.enabled;
  };
  tuning.onChange(applyTuning);

  const hud = createHud();
  const stats = new FrameStats();
  let topSpeed = 0;

  const loop = new FixedLoop({
    tickRate: simulation.tickRate,
    tick(dt) {
      if (input.consumePresses("reset") > 0) newRound();
      if (player.feet.y < -20) {
        player.teleport(level.spawn.position);
        look.yaw = level.spawn.yaw;
      }
      if (caught) return;
      const axis = (a: Action, b: Action) => (input.isDown(a) ? 1 : 0) - (input.isDown(b) ? 1 : 0);
      player.tick(
        {
          forward: axis("forward", "back"),
          side: axis("right", "left"),
          jumpPresses: input.consumePresses("jump"),
          jumpHeld: input.isDown("jump"),
          crouch: input.isDown("crouch"),
          walk: input.isDown("walk"),
          yaw: look.yaw,
        },
        dt,
      );
      noise.update(player, noises);
      // The chaser waits while the menu is open.
      if (chase.enabled && look.isLocked) {
        const p = player.feet;
        chaser.update(
          dt,
          {
            feet: { x: p.x, y: p.y, z: p.z },
            eye: { x: p.x, y: p.y + player.eyeHeight, z: p.z },
            velocity: { ...player.velocity },
            colliderHandle: player.colliderHandle,
          },
          noises.drain(),
        );
        if (chaser.events.caught) {
          caught = true;
          caughtScreen.hidden = false;
        }
      } else {
        noises.drain();
      }
      world.step();
      rig.afterTick(player);
      topSpeed = Math.max(topSpeed, player.horizontalSpeed);
    },
    render(alpha, frameDt) {
      stats.push(frameDt);
      rig.update(player, alpha, look.yaw, look.pitch, frameDt);
      chaserView.update(chaser, alpha, frameDt, camera, chase.enabled ? chase.footstepVolume : 0);
      renderer.render(scene, camera);
      hud.update({
        speed: player.horizontalSpeed,
        speedUnits: player.horizontalSpeed / SOURCE_UNIT,
        topSpeed,
        grounded: player.grounded,
        ducked: player.ducked,
        fps: stats.fps,
        avgMs: stats.averageMs,
        worstMs: stats.worstMs,
        rawInput: look.rawInput,
        tickRate: loop.tickRate,
        zones: triggersAt(world, level, { x: player.feet.x, y: player.feet.y + 0.9, z: player.feet.z }),
        chaser: chase.enabled
          ? {
              awareness: chaser.awareness,
              distance: Math.hypot(chaser.body.feet.x - player.feet.x, chaser.body.feet.z - player.feet.z),
            }
          : null,
      });
    },
  });

  // Dev server: saving the .blend re-exports it and swaps the level in place (see tools/vite-plugin-blender-levels.ts).
  if (import.meta.hot) {
    let reloading = Promise.resolve();
    import.meta.hot.on("blender-levels:update", ({ url }: { url: string }) => {
      if (url !== SANDBOX_URL) return;
      reloading = reloading.then(async () => {
        try {
          const next = await loadLevel(world, `${url}?t=${Date.now()}`);
          level.root.traverse((obj) => {
            if (obj instanceof THREE.Sprite) {
              obj.material.map?.dispose();
              obj.material.dispose();
            }
          });
          disposeLevel(world, level);
          level = next;
          dress(level);
          world.step(); // so the next tick's ground checks see the new colliders
          nav.dispose();
          nav = Navigation.build(level.solids, agent());
          chaser.setNavigation(nav);
          director.chokepoints = chokepoints();
          updateNavHelper();
          console.info(`[levels] reloaded ${url}`);
        } catch (err) {
          console.error(`[levels] couldn't reload ${url}`, err);
        }
      });
    });
    import.meta.hot.on("blender-levels:error", ({ file, message }: { file: string; message: string }) => {
      console.error(`[levels] export of ${file} failed:\n${message}`);
    });
  }

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  // Click to play; Esc (handled by the browser) releases the mouse and shows the menu.
  const overlay = document.querySelector<HTMLElement>("#overlay")!;
  overlay.addEventListener("click", () => {
    chaserView.unlockAudio();
    void look.lock();
  });
  look.onLockChanged((locked) => {
    overlay.hidden = locked;
    if (!locked) input.releaseAll();
  });
  // Ctrl is a crouch key and Ctrl+W closes tabs: ask before leaving mid-game.
  window.addEventListener("beforeunload", (e) => {
    if (look.isLocked) e.preventDefault();
  });

  applyTuning();
  document.querySelector("#loading")?.remove();
  loop.start();
}

function textSprite(text: string, position: [number, number, number]): THREE.Sprite {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = "600 48px system-ui, sans-serif";
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + 32;
  c.height = 72;
  ctx.font = font;
  ctx.fillStyle = "rgba(20, 24, 32, 0.75)";
  ctx.roundRect(0, 0, c.width, c.height, 14);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 16, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set((c.width / c.height) * 0.5, 0.5, 1);
  sprite.position.set(...position);
  return sprite;
}

main().catch((err) => {
  console.error(err);
  const el = document.querySelector("#loading");
  if (el) el.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
