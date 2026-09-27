import * as THREE from "three";
import { FixedLoop, FrameStats } from "@slop/core";
import { ActionInput, MouseLook, attachDomInput } from "@slop/input";
import { createPhysicsWorld } from "@slop/physics";
import { loadLevel, triggersAt } from "@slop/level-loader";
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
  const level = await loadLevel(world, SANDBOX_URL);
  const materials = new Map<Surface, THREE.Material>();
  level.root.traverse((obj) => {
    const surface = obj.userData.surface as Surface | undefined;
    if (obj instanceof THREE.Mesh && surface && surface in surfaceColors) {
      if (!materials.has(surface)) materials.set(surface, gridMaterial(surfaceColors[surface]));
      obj.material = materials.get(surface)!;
      obj.castShadow = surface !== "floor";
      obj.receiveShadow = true;
    }
    if (typeof obj.userData.label === "string") {
      scene.add(textSprite(obj.userData.label, obj.getWorldPosition(new THREE.Vector3()).toArray()));
    }
  });
  scene.add(level.root);
  world.step();

  // Settings objects are shared by reference with the tuning panel.
  const movement: MovementSettings = { ...tokyoMovement };
  const cameraFeel = { ...defaultCameraFeel };
  const simulation = { tickRate: 66.67 };

  const player = new PlayerController(world, movement, level.spawn.position);
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
  tuning.addGroup("Simulation", simulation, { tickRate: [20, 144, 1] });
  tuning.addPersistence();
  tuning.load();
  tuning.onChange(() => {
    player.applySettings();
    loop.tickRate = simulation.tickRate;
  });

  const hud = createHud();
  const stats = new FrameStats();
  let topSpeed = 0;

  const loop = new FixedLoop({
    tickRate: simulation.tickRate,
    tick(dt) {
      if (input.consumePresses("reset") > 0 || player.feet.y < -20) {
        player.teleport(level.spawn.position);
        look.yaw = level.spawn.yaw;
        look.pitch = 0;
        topSpeed = 0;
      }
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
      world.step();
      rig.afterTick(player);
      topSpeed = Math.max(topSpeed, player.horizontalSpeed);
    },
    render(alpha, frameDt) {
      stats.push(frameDt);
      rig.update(player, alpha, look.yaw, look.pitch, frameDt);
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
      });
    },
  });

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
  overlay.addEventListener("click", () => void look.lock());
  look.onLockChanged((locked) => {
    overlay.hidden = locked;
    if (!locked) input.releaseAll();
  });
  // Ctrl is a crouch key and Ctrl+W closes tabs: ask before leaving mid-game.
  window.addEventListener("beforeunload", (e) => {
    if (look.isLocked) e.preventDefault();
  });

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
