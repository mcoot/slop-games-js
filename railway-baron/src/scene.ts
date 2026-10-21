import * as THREE from "three";
import type { PetKind, Reply, Taunt } from "./shared/wire";

/**
 * The stage: a stretch of desert railway with the pet tied to the tracks, the lever and
 * its robot, the baron, and the train coming. All built from primitives in code. The
 * game drives it (`setPet`, `setRobot`, `setTrain`, `ending`) and it animates itself.
 */

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
};
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const ball = (r: number) => new THREE.SphereGeometry(r, 20, 14);
const cyl = (rt: number, rb: number, h: number, seg = 18) => new THREE.CylinderGeometry(rt, rb, h, seg);

/** Where the siding to the baron's mansion leaves the main line. */
const SWITCH_X = -7;
const SIDING = new THREE.Vector3(0.15, 0, -1).normalize();
const SIDING_LENGTH = 30;
/** How far off the train is when the round starts. */
const TRAIN_FAR = 150;
const LOOK = new THREE.Vector3(-3, 0.8, -3);
const LOOK_TALL = new THREE.Vector3(0.8, 0.8, -1);
/** The camera's place, from where it looks. */
const VIEW = new THREE.Vector3(11, 4.7, 16);

const ROBOT_COLOURS: Partial<Record<Reply | "thinking" | "idle", number>> = {
  yes: 0x3ddc84,
  correct: 0x3ddc84,
  no: 0xff4d4d,
  wrong: 0xff4d4d,
  unsure: 0xffc53d,
  refused: 0x9aa4ff,
  error: 0x9aa4ff,
  thinking: 0x6fd3ff,
  idle: 0x6fd3ff,
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
  private readonly clock = new THREE.Clock();
  private t = 0;
  private camDistance = 1;
  private readonly look = LOOK.clone();

  private pet = new THREE.Group();
  private petKind: PetKind | null = null;
  private readonly ropes = new THREE.Group();
  private readonly robot = new THREE.Group();
  private readonly robotHead = new THREE.Group();
  private readonly eyes: THREE.Mesh[] = [];
  private readonly antenna: THREE.Mesh;
  private readonly lever = new THREE.Group();
  private readonly baron = new THREE.Group();
  private readonly hat: THREE.Object3D;
  private readonly train = new THREE.Group();
  private readonly wheels: THREE.Mesh[] = [];
  private readonly smoke: THREE.Mesh[] = [];
  private readonly stars = new THREE.Group();

  private robotMood: Reply | "thinking" | "idle" = "idle";
  /** Where the train is along the line: metres from the pet, before the switch. */
  private trainAt = TRAIN_FAR;
  private trainTarget = TRAIN_FAR;
  private trainSpeed = 0;
  private outcome: "freed" | "train" | "questions" | null = null;
  private endT = 0;
  private taunt: { kind: Taunt; t: number } | null = null;
  private petFlight = { y: 0, vy: 0, spin: 0, landed: false };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0xf6c58f);
    this.scene.fog = new THREE.Fog(0xf6c58f, 40, 220);

    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.position.set(20, 30, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, far: 100 });
    this.scene.add(sun, new THREE.HemisphereLight(0xffe3c2, 0x8a5a3a, 1.2));

    this.desert();
    this.track();
    this.mansion();
    this.buildLever();
    this.antenna = this.buildRobot();
    this.hat = this.buildBaron();
    this.buildTrain();
    this.stars.visible = false;
    for (let i = 0; i < 5; i++) {
      const s = mesh(new THREE.OctahedronGeometry(0.14), mat(0xffe14d, { emissive: 0x806a00 }));
      this.stars.add(s);
    }
    this.scene.add(this.stars, this.ropes);
    this.setPet("snake");

    this.resize();
    addEventListener("resize", () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Pull back on narrow screens so the pet, robot and baron stay in shot.
    this.camera.fov = w < h ? 62 : 50;
    this.camDistance = w < h ? 1.7 : 1;
    // On a tall screen, aim nearer the pet so the baron and the robot both fit.
    this.look.copy(w < h ? LOOK_TALL : LOOK);
    // Centre the action in the space the panel leaves: to its left on a wide screen,
    // above it on a narrow one.
    if (w > 760) this.camera.setViewOffset(w + 392, h, 392, 0, w, h);
    else this.camera.setViewOffset(w, h + h * 0.45, 0, h * 0.45, w, h);
    this.camera.updateProjectionMatrix();
  }

  private desert(): void {
    const ground = mesh(new THREE.PlaneGeometry(600, 600), mat(0xe0a96d));
    ground.rotation.x = -Math.PI / 2;
    ground.castShadow = false;
    this.scene.add(ground);
    const rand = mulberry(7);
    // Mesas on the horizon, cacti and rocks nearer.
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI - Math.PI * 0.1;
      const d = 110 + rand() * 80;
      const w = 10 + rand() * 25;
      const h = 8 + rand() * 18;
      const m = mesh(cyl(w * 0.8, w, h, 7), mat(i % 2 ? 0xc0703f : 0xb05f35), -Math.cos(a) * d, h / 2, -Math.sin(a) * d);
      this.scene.add(m);
    }
    for (let i = 0; i < 26; i++) {
      const x = (rand() - 0.5) * 90;
      const z = (rand() - 0.5) * 60;
      if (Math.abs(z) < 4 || (x > -14 && x < 14 && z > -6 && z < 12)) continue;
      if (rand() < 0.6) this.scene.add(cactus(x, z, 0.8 + rand() * 1.2));
      else this.scene.add(mesh(new THREE.DodecahedronGeometry(0.4 + rand() * 0.8), mat(0xa9714a), x, 0.2, z));
    }
  }

  private track(): void {
    const rail = mat(0x6b6f76, { metalness: 0.7, roughness: 0.4 });
    const wood = mat(0x6e4a2f);
    const line = (from: THREE.Vector3, dir: THREE.Vector3, length: number) => {
      const g = new THREE.Group();
      for (const side of [-0.55, 0.55]) g.add(mesh(box(length, 0.12, 0.08), rail, length / 2, 0.22, side));
      for (let s = 0.5; s < length; s += 1.1) g.add(mesh(box(0.3, 0.1, 1.7), wood, s, 0.06, 0));
      g.position.copy(from);
      g.rotation.y = -Math.atan2(dir.z, dir.x);
      this.scene.add(g);
    };
    line(new THREE.Vector3(-220, 0, 0), new THREE.Vector3(1, 0, 0), 300);
    line(new THREE.Vector3(SWITCH_X, 0, 0), SIDING, SIDING_LENGTH);
  }

  private mansion(): void {
    const p = new THREE.Vector3(SWITCH_X, 0, 0).addScaledVector(SIDING, SIDING_LENGTH + 5);
    const g = new THREE.Group();
    const wall = mat(0x3b2a3f);
    const roof = mat(0x1d1420);
    g.add(mesh(box(14, 9, 9), wall, 0, 4.5, 0));
    g.add(mesh(new THREE.ConeGeometry(9, 5, 4), roof, 0, 11.5, 0));
    g.add(mesh(cyl(1.8, 1.8, 15), wall, -6, 7.5, 3));
    g.add(mesh(new THREE.ConeGeometry(2.4, 4, 12), roof, -6, 17, 3));
    // A doorway the train goes in by.
    g.add(mesh(box(3.2, 4, 0.4), mat(0x090609), 0, 2, 4.6));
    for (const x of [-4, 4]) g.add(mesh(box(1.4, 2, 0.3), mat(0xffd36e, { emissive: 0xb07a10 }), x, 6, 4.6));
    g.position.copy(p);
    g.scale.setScalar(0.7);
    g.lookAt(new THREE.Vector3(SWITCH_X, 0, 0));
    this.scene.add(g);
  }

  private buildLever(): void {
    const base = mesh(box(1.4, 0.9, 1), mat(0x7a2b2b), 0, 0.45, 0);
    const plate = mesh(box(0.5, 0.5, 0.05), mat(0xd9b44a, { metalness: 0.8, roughness: 0.3 }), 0, 0.55, 0.52);
    const arm = new THREE.Group();
    arm.add(mesh(cyl(0.06, 0.06, 1.4), mat(0x333333, { metalness: 0.8 }), 0, 0.7, 0));
    arm.add(mesh(ball(0.16), mat(0xe02b2b), 0, 1.45, 0));
    arm.position.y = 0.9;
    arm.rotation.z = 0.6;
    arm.name = "arm";
    this.lever.add(base, plate, arm);
    // The mechanism: cables to the pet's ropes.
    const cable = mesh(cyl(0.025, 0.025, 2.2), mat(0x222222), -1.3, 0.12, 1.5);
    cable.rotation.z = Math.PI / 2;
    cable.rotation.y = 0.9;
    this.lever.add(cable);
    this.lever.position.set(2.6, 0, -2.6);
    this.scene.add(this.lever);
  }

  private buildRobot(): THREE.Mesh {
    const metal = mat(0xb8c2cc, { metalness: 0.6, roughness: 0.35 });
    const dark = mat(0x4a5560, { metalness: 0.5 });
    this.robot.add(mesh(box(1, 1.1, 0.7), metal, 0, 1.15, 0));
    this.robot.add(mesh(box(0.6, 0.35, 0.05), mat(0x203040, { emissive: 0x0a3050 }), 0, 1.25, 0.36));
    for (const x of [-0.25, 0.25]) this.robot.add(mesh(cyl(0.12, 0.14, 0.6), dark, x, 0.3, 0));
    for (const x of [-0.65, 0.65]) {
      const a = mesh(cyl(0.08, 0.08, 0.8), dark, x, 1.15, 0);
      a.rotation.z = x > 0 ? 0.3 : -0.3;
      this.robot.add(a);
    }
    this.robotHead.add(mesh(box(0.8, 0.6, 0.6), metal, 0, 0, 0));
    for (const x of [-0.18, 0.18]) {
      const e = mesh(ball(0.1), mat(0x6fd3ff, { emissive: 0x6fd3ff, emissiveIntensity: 1.2 }), x, 0.05, 0.3);
      this.eyes.push(e);
      this.robotHead.add(e);
    }
    this.robotHead.add(mesh(cyl(0.02, 0.02, 0.4), dark, 0, 0.5, 0));
    const antenna = mesh(ball(0.08), mat(0xff4d4d, { emissive: 0xff2020 }), 0, 0.72, 0);
    this.robotHead.add(antenna);
    this.robotHead.position.y = 2.05;
    this.robot.add(this.robotHead);
    this.robot.position.set(4.4, 0, -2.2);
    this.robot.rotation.y = 0.2;
    this.scene.add(this.robot);
    return antenna;
  }

  private buildBaron(): THREE.Object3D {
    const black = mat(0x1a1a22);
    const skin = mat(0xf1c9a5);
    this.baron.add(mesh(cyl(0.35, 0.6, 1.5), black, 0, 0.75, 0));
    this.baron.add(mesh(box(0.25, 0.5, 0.06), mat(0xffffff), 0, 1.25, 0.3));
    this.baron.add(mesh(box(0.2, 0.12, 0.05), mat(0xaa1020), 0, 1.45, 0.34));
    this.baron.add(mesh(ball(0.35), skin, 0, 1.85, 0));
    // A moustache made for twirling, and a monocle.
    for (const s of [-1, 1]) {
      const m = mesh(new THREE.TorusGeometry(0.12, 0.035, 8, 16, Math.PI * 1.2), black, s * 0.12, 1.76, 0.32);
      m.rotation.z = s > 0 ? -0.4 : Math.PI + 0.4;
      this.baron.add(m);
    }
    this.baron.add(mesh(new THREE.TorusGeometry(0.09, 0.015, 8, 20), mat(0xd9b44a, { metalness: 0.9 }), 0.13, 1.92, 0.33));
    const hat = new THREE.Group();
    hat.add(mesh(cyl(0.45, 0.45, 0.04), black, 0, 0, 0));
    hat.add(mesh(cyl(0.28, 0.3, 0.75), black, 0, 0.4, 0));
    hat.add(mesh(cyl(0.305, 0.305, 0.1), mat(0xaa1020), 0, 0.1, 0));
    hat.position.y = 2.15;
    this.baron.add(hat);
    // A cane.
    const cane = mesh(cyl(0.03, 0.03, 1.3), black, 0.55, 0.65, 0.2);
    cane.rotation.z = -0.15;
    this.baron.add(cane, mesh(ball(0.07), mat(0xd9b44a, { metalness: 0.9 }), 0.64, 1.3, 0.2));
    this.baron.position.set(-2.8, 0, 3.6);
    this.baron.rotation.y = 0.6;
    this.scene.add(this.baron);
    return hat;
  }

  private buildTrain(): void {
    const red = mat(0xb3262c, { roughness: 0.5 });
    const black = mat(0x1c1c1c, { metalness: 0.4 });
    const brass = mat(0xd9b44a, { metalness: 0.9, roughness: 0.3 });
    const boiler = mesh(cyl(0.75, 0.75, 4.2), black, 0.6, 1.6, 0);
    boiler.rotation.z = Math.PI / 2;
    this.train.add(boiler);
    this.train.add(mesh(box(1.8, 2.4, 2), red, -2.2, 1.9, 0));
    this.train.add(mesh(box(2.2, 0.15, 2.2), black, -2.2, 3.15, 0));
    this.train.add(mesh(cyl(0.25, 0.35, 1.1), black, 2.1, 2.7, 0));
    this.train.add(mesh(cyl(0.4, 0.25, 0.25), brass, 2.1, 3.3, 0));
    this.train.add(mesh(box(5.4, 0.4, 1.6), red, -0.3, 0.75, 0));
    const catcher = mesh(new THREE.ConeGeometry(0.9, 1, 4), red, 3.0, 0.6, 0);
    catcher.rotation.z = -Math.PI / 2;
    this.train.add(catcher);
    this.train.add(mesh(ball(0.28), mat(0xfff3b0, { emissive: 0xffd966, emissiveIntensity: 1.5 }), 2.8, 2.0, 0));
    for (const x of [-2.4, -0.9, 0.6, 1.9]) {
      for (const z of [-0.75, 0.75]) {
        const w = mesh(cyl(0.45, 0.45, 0.15), red, x, 0.5, z);
        w.rotation.x = Math.PI / 2;
        this.wheels.push(w);
        this.train.add(w);
      }
    }
    // A coal tender behind.
    this.train.add(mesh(box(2.6, 1.4, 1.9), black, -4.8, 1.3, 0));
    this.scene.add(this.train);
    const puff = mat(0xf4f0ea, { transparent: true, opacity: 0.8 });
    for (let i = 0; i < 10; i++) {
      const s = mesh(ball(0.5), puff);
      s.castShadow = false;
      this.smoke.push(s);
      this.scene.add(s);
    }
  }

  setPet(kind: PetKind): void {
    if (kind === this.petKind) return;
    this.petKind = kind;
    this.scene.remove(this.pet);
    this.pet = buildPet(kind);
    this.pet.scale.setScalar(1.5);
    this.scene.add(this.pet);
    this.tie();
  }

  private tie(): void {
    this.ropes.clear();
    const rope = mat(0xc9a66b);
    for (const x of [-0.5, 0.5]) {
      const r = mesh(new THREE.TorusGeometry(0.42, 0.04, 6, 20), rope, x, 0.45, 0);
      r.rotation.y = Math.PI / 2;
      this.ropes.add(r);
    }
    this.ropes.visible = true;
  }

  setRobot(mood: Reply | "thinking" | "idle"): void {
    this.robotMood = mood;
    const c = ROBOT_COLOURS[mood] ?? 0x6fd3ff;
    for (const e of this.eyes) {
      const m = e.material as THREE.MeshStandardMaterial;
      m.color.setHex(c);
      m.emissive.setHex(c);
    }
  }

  /** Where the train should be, from how long it has left. */
  setTrain(msLeft: number, roundMs: number): void {
    if (this.outcome) return;
    this.trainTarget = 6 + (msLeft / roundMs) * (TRAIN_FAR - 6);
  }

  doTaunt(kind: Taunt): void {
    this.taunt = { kind, t: 0 };
  }

  ending(outcome: "freed" | "train" | "questions" | null): void {
    if (outcome === this.outcome) return;
    this.outcome = outcome;
    this.endT = 0;
    this.petFlight = { y: 0, vy: 0, spin: 0, landed: false };
    this.stars.visible = false;
    const arm = this.lever.getObjectByName("arm")!;
    arm.rotation.z = outcome === "freed" ? -0.6 : 0.6;
    if (!outcome) {
      // A new round: everything back as it was.
      this.trainAt = this.trainTarget = TRAIN_FAR;
      this.trainSpeed = 0;
      this.pet.position.set(0, 0, 0);
      this.pet.rotation.set(0, 0, 0);
      this.tie();
      this.setRobot("idle");
    } else {
      // Bring it on quickly for the finale.
      this.trainAt = Math.min(this.trainAt, 45);
      this.trainSpeed = Math.max(this.trainSpeed, 12);
      if (outcome === "freed") this.ropes.visible = false;
    }
  }

  /** The robot's head on screen, in CSS pixels, for its speech bubble. */
  robotOnScreen(): { x: number; y: number } {
    const p = new THREE.Vector3();
    this.robotHead.getWorldPosition(p);
    p.y += 0.9;
    p.project(this.camera);
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight };
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.t += dt;
    const t = this.t;

    // The robot bobs, and its antenna blinks while it thinks.
    this.robot.position.y = Math.sin(t * 2) * 0.04;
    this.robotHead.rotation.z = this.robotMood === "thinking" ? Math.sin(t * 9) * 0.12 : Math.sin(t * 0.7) * 0.03;
    this.antenna.visible = this.robotMood !== "thinking" || Math.sin(t * 14) > 0;
    this.robotHead.rotation.y = this.robotMood === "no" || this.robotMood === "wrong" ? Math.sin(t * 12) * 0.35 : 0;
    this.robotHead.position.y = 2.05 + (this.robotMood === "yes" || this.robotMood === "correct" ? Math.abs(Math.sin(t * 8)) * 0.12 : 0);

    this.animateBaron(dt);
    this.animatePet(dt, t);
    this.animateTrain(dt, t);

    // The camera breathes a little.
    this.camera.position.copy(this.look).addScaledVector(VIEW, this.camDistance);
    this.camera.position.x += Math.sin(t * 0.15) * 0.6;
    this.camera.lookAt(this.look);
    this.renderer.render(this.scene, this.camera);
  }

  private animateBaron(dt: number): void {
    this.baron.rotation.y = 0.6;
    this.baron.position.y = 0;
    this.hat.position.y = 2.15;
    this.hat.rotation.z = 0;
    const tt = this.taunt;
    if (tt) {
      tt.t += dt;
      const k = tt.t / 1.4;
      if (k >= 1) this.taunt = null;
      else if (tt.kind === "laugh") this.baron.position.y = Math.abs(Math.sin(k * Math.PI * 6)) * 0.25;
      else if (tt.kind === "twirl") this.baron.rotation.y = 0.6 + k * Math.PI * 2;
      else {
        this.hat.position.y = 2.15 + Math.sin(k * Math.PI) * 0.6;
        this.hat.rotation.z = Math.sin(k * Math.PI) * 0.4;
      }
    }
    if (this.outcome === "freed") {
      // The baron stamps his foot.
      this.baron.position.y = Math.max(0, Math.sin(this.endT * 10)) * 0.15;
    }
  }

  private animatePet(dt: number, t: number): void {
    const p = this.pet;
    const f = this.petFlight;
    if (this.outcome === "freed") {
      // Hop off the track, and dance.
      const k = Math.min(this.endT / 0.8, 1);
      p.position.set(0, Math.sin(k * Math.PI) * 1.5 + (k === 1 ? Math.abs(Math.sin(t * 6)) * 0.2 : 0), k * 2.4);
      p.rotation.y = k === 1 ? Math.sin(t * 3) * 0.6 : k * Math.PI * 2;
    } else if (this.outcome && this.trainAt < 2.5) {
      // The train arrives: boing! Off into the sky, and down, dazed but fine.
      if (!f.vy && !f.landed) {
        f.vy = 16;
        f.spin = 9;
        this.ropes.visible = false;
      }
      if (!f.landed) {
        f.vy -= 20 * dt;
        f.y += f.vy * dt;
        p.position.x += 3 * dt;
        p.position.z += 2.2 * dt;
        p.rotation.x += f.spin * dt;
        p.rotation.z += f.spin * 0.7 * dt;
        if (f.y <= 0 && f.vy < 0) {
          f.y = 0;
          f.landed = true;
          p.rotation.set(0, 0, Math.PI * 0.1);
          this.stars.visible = true;
        }
        p.position.y = f.y;
      }
    } else if (!this.outcome) {
      // Wriggling on the tracks.
      p.rotation.y = Math.sin(t * 3) * 0.08;
      p.position.y = Math.abs(Math.sin(t * 5)) * 0.05;
    }
    wiggle(p, t);
    if (this.stars.visible) {
      this.stars.children.forEach((s, i) => {
        const a = t * 3 + (i / 5) * Math.PI * 2;
        s.position.set(p.position.x + Math.cos(a) * 0.7, 1.4 + Math.sin(t * 4 + i) * 0.1, p.position.z + Math.sin(a) * 0.7);
        s.rotation.y = t * 4;
      });
    }
  }

  private animateTrain(dt: number, t: number): void {
    if (this.outcome) {
      // Ending: full steam ahead.
      this.trainSpeed = Math.min(this.trainSpeed + dt * 6, 22);
      this.endT += dt;
      this.trainAt -= this.trainSpeed * dt;
    } else {
      // Ease toward where the clock says it is.
      this.trainAt += (this.trainTarget - this.trainAt) * Math.min(1, dt * 2);
    }
    const pos = new THREE.Vector3();
    // The loco's middle is 3 m behind its front; at the switch, it takes the siding.
    const atSwitch = -SWITCH_X - 3;
    if (this.outcome === "freed" && this.trainAt < atSwitch) {
      const along = atSwitch - this.trainAt;
      pos.set(SWITCH_X, 0, 0).addScaledVector(SIDING, Math.min(along, SIDING_LENGTH + 4));
      this.train.rotation.y = -Math.atan2(SIDING.z, SIDING.x);
      // Into the mansion it goes.
      this.train.visible = along < SIDING_LENGTH + 4;
    } else {
      pos.set(-this.trainAt - 3, 0, 0);
      this.train.rotation.y = 0;
      this.train.visible = this.trainAt > -40;
    }
    this.train.position.copy(pos);
    for (const w of this.wheels) w.rotation.y += dt * (this.outcome ? this.trainSpeed : 2);
    this.smoke.forEach((s, i) => {
      const k = (t * 0.6 + i / this.smoke.length) % 1;
      const chimney = new THREE.Vector3(2.1, 3.3, 0).applyMatrix4(this.train.matrixWorld);
      s.position.set(chimney.x - k * 6, chimney.y + k * 4, chimney.z + Math.sin(i) * k);
      s.scale.setScalar(0.4 + k * 1.6);
      (s.material as THREE.MeshStandardMaterial).opacity = 0.8 * (1 - k);
      s.visible = this.train.visible;
    });
  }
}

function cactus(x: number, z: number, s: number): THREE.Group {
  const g = new THREE.Group();
  const m = mat(0x4f8a3c);
  g.add(mesh(new THREE.CapsuleGeometry(0.3, 2, 4, 10), m, 0, 1.2, 0));
  const arm = mesh(new THREE.CapsuleGeometry(0.2, 0.7, 4, 8), m, 0.5, 1.5, 0);
  g.add(arm, mesh(new THREE.CapsuleGeometry(0.2, 0.4, 4, 8), m, 0.3, 1.25, 0));
  g.add(mesh(new THREE.CapsuleGeometry(0.18, 0.5, 4, 8), m, -0.45, 1.8, 0));
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  return g;
}

function buildPet(kind: PetKind): THREE.Group {
  const g = new THREE.Group();
  const eye = (x: number, y: number, z: number, r = 0.07) => {
    const e = new THREE.Group();
    e.add(mesh(ball(r), mat(0xffffff), 0, 0, 0), mesh(ball(r * 0.55), mat(0x111111), 0, 0, r * 0.6));
    e.position.set(x, y, z);
    return e;
  };
  if (kind === "snake") {
    // A chain of green beads across the rails, wiggled in `wiggle`.
    const green = mat(0x5fbf3f);
    for (let i = 0; i < 14; i++) {
      const s = mesh(ball(0.17 - i * 0.006), green, 0, 0.32, -1.3 + i * 0.2);
      s.name = "seg";
      g.add(s);
    }
    const head = new THREE.Group();
    head.add(mesh(ball(0.22), green, 0, 0, 0));
    head.add(eye(-0.1, 0.12, 0.12), eye(0.1, 0.12, 0.12));
    const tongue = mesh(box(0.03, 0.01, 0.25), mat(0xe0336b), 0, -0.03, 0.3);
    head.add(tongue);
    head.position.set(0, 0.38, -1.55);
    head.rotation.y = Math.PI;
    g.add(head);
  } else if (kind === "lobster") {
    const red = mat(0xe0442b, { roughness: 0.5 });
    const body = mesh(ball(0.35), red, 0, 0.45, 0);
    body.scale.set(1, 0.8, 1.5);
    g.add(body);
    for (let i = 0; i < 4; i++) {
      const seg = mesh(ball(0.26 - i * 0.04), red, 0, 0.4, -0.55 - i * 0.22);
      seg.scale.set(1, 0.6, 0.9);
      g.add(seg);
    }
    g.add(mesh(new THREE.ConeGeometry(0.25, 0.3, 5), red, 0, 0.4, -1.45));
    for (const s of [-1, 1]) {
      const claw = new THREE.Group();
      claw.add(mesh(cyl(0.06, 0.06, 0.5), red, 0, 0, 0.25));
      (claw.children[0] as THREE.Mesh).rotation.x = Math.PI / 2;
      const pincer = mesh(ball(0.2), red, 0, 0, 0.6);
      pincer.scale.set(0.7, 0.5, 1.2);
      claw.add(pincer);
      claw.position.set(s * 0.3, 0.55, 0.4);
      claw.rotation.y = s * 0.5;
      claw.name = "claw";
      g.add(claw);
      const ant = mesh(cyl(0.01, 0.01, 0.9), red, s * 0.1, 0.8, 0.8);
      ant.rotation.x = 1.0;
      ant.rotation.z = -s * 0.3;
      g.add(ant);
    }
    g.add(eye(-0.12, 0.7, 0.45), eye(0.12, 0.7, 0.45));
    g.rotation.y = Math.PI / 2;
  } else {
    // A sunfish: a big flat silver disc, nearly all head, with a fin top and bottom.
    const skin = mat(0x9aa9b5, { roughness: 0.6 });
    const body = mesh(ball(0.65), skin, 0, 0.75, 0);
    body.scale.set(1, 1, 0.32);
    g.add(body);
    const fin = new THREE.Shape();
    fin.moveTo(-0.15, 0);
    fin.quadraticCurveTo(0.05, 0.7, 0.25, 0.85);
    fin.lineTo(0.2, 0);
    const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.05, bevelEnabled: false });
    const top = mesh(finGeo, skin, -0.1, 1.3, -0.025);
    const bottom = mesh(finGeo, skin, -0.1, 0.2, -0.025);
    bottom.scale.y = -1;
    g.add(top, bottom);
    const tail = mesh(box(0.12, 1.0, 0.12), mat(0x8494a0), -0.62, 0.75, 0);
    g.add(tail);
    g.add(eye(0.38, 0.95, 0.2, 0.1), eye(0.38, 0.95, -0.2, 0.1));
    g.add(mesh(new THREE.TorusGeometry(0.06, 0.02, 6, 12), mat(0x5d6a75), 0.6, 0.62, 0));
    g.rotation.y = Math.PI / 2;
    g.name = "sunfish";
  }
  return g;
}

/** Each pet's own idle motion. */
function wiggle(g: THREE.Group, t: number): void {
  let i = 0;
  for (const c of g.children) {
    if (c.name === "seg") c.position.x = Math.sin(t * 4 + i++ * 0.7) * 0.12;
    if (c.name === "claw") c.rotation.x = Math.sin(t * 6 + i++) * 0.25;
  }
}

function mulberry(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
