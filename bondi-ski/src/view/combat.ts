import * as THREE from "three";
import type { Projectile } from "../combat/projectiles";

/**
 * Drawing the fight: projectiles (glowing spinning discs, rifle tracers), explosions,
 * other fighters, and the weapon in your hands.
 */
export class ProjectileViews {
  readonly root = new THREE.Group();
  private readonly meshes = new Map<string, THREE.Object3D>();
  private readonly discGeom = new THREE.CylinderGeometry(0.28, 0.28, 0.07, 18);
  private readonly discMat = new THREE.MeshBasicMaterial({ color: "#bdf6ff" });
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: "#44d6ff", transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly glowGeom = new THREE.SphereGeometry(0.55, 12, 8);
  private readonly tracerGeom = new THREE.BoxGeometry(0.05, 0.05, 2.2);
  private readonly tracerMat = new THREE.MeshBasicMaterial({ color: "#ffe28a" });

  update(list: Projectile[], alpha: number, dt: number): void {
    const live = new Set<string>();
    for (const p of list) {
      live.add(p.id);
      let m = this.meshes.get(p.id);
      if (!m) {
        m = p.weapon.id === "disc" ? this.disc() : new THREE.Mesh(this.tracerGeom, this.tracerMat);
        this.meshes.set(p.id, m);
        this.root.add(m);
      }
      // Between last tick and this one, like everything else.
      m.position.set(p.prev.x + (p.pos.x - p.prev.x) * alpha, p.prev.y + (p.pos.y - p.prev.y) * alpha, p.prev.z + (p.pos.z - p.prev.z) * alpha);
      if (p.weapon.id === "disc") {
        m.children[0]!.rotation.y += dt * 30;
      } else {
        m.lookAt(m.position.x + p.vel.x, m.position.y + p.vel.y, m.position.z + p.vel.z);
      }
    }
    for (const [id, m] of this.meshes) {
      if (live.has(id)) continue;
      m.removeFromParent();
      this.meshes.delete(id);
    }
  }

  private disc(): THREE.Object3D {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.discGeom, this.discMat), new THREE.Mesh(this.glowGeom, this.glowMat));
    return g;
  }
}

interface Blast {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  size: number;
}

/** Disc blasts (a flash and an expanding shell of blue-white) and rifle sparks. */
export class Explosions {
  readonly root = new THREE.Group();
  private readonly blasts: Blast[] = [];
  private readonly geom = new THREE.SphereGeometry(1, 16, 12);

  spawn(point: { x: number; y: number; z: number }, radius: number): void {
    const big = radius > 0;
    const mat = new THREE.MeshBasicMaterial({
      color: big ? "#bff4ff" : "#fff1a8",
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.geom, mat);
    mesh.position.set(point.x, point.y, point.z);
    this.root.add(mesh);
    this.blasts.push({ mesh, age: 0, life: big ? 0.45 : 0.12, size: big ? radius * 0.8 : 0.35 });
  }

  update(dt: number): void {
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i]!;
      b.age += dt;
      const f = b.age / b.life;
      b.mesh.scale.setScalar(b.size * (0.3 + 0.7 * Math.sqrt(f)));
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - f);
      if (f >= 1) {
        b.mesh.removeFromParent();
        (b.mesh.material as THREE.Material).dispose();
        this.blasts.splice(i, 1);
      }
    }
  }
}

/** Another fighter: body in their colour, a launcher, a name tag and a health bar. */
export class FighterView {
  readonly root = new THREE.Group();
  private readonly gun: THREE.Group;
  private readonly bar: THREE.Mesh;
  private readonly label: THREE.Sprite;

  constructor(
    readonly name: string,
    colour: string,
    height: number,
  ) {
    const mat = new THREE.MeshLambertMaterial({ color: colour });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, height - 0.68, 4, 10), mat);
    body.position.y = height / 2;
    body.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.22), new THREE.MeshBasicMaterial({ color: "#10202c" }));
    visor.position.set(0, height - 0.32, -0.24);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.25), new THREE.MeshLambertMaterial({ color: "#3a4650" }));
    pack.position.set(0, height * 0.62, 0.34);
    this.gun = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.9), new THREE.MeshLambertMaterial({ color: "#2a3036" }));
    barrel.position.z = -0.45;
    this.gun.add(barrel);
    this.gun.position.set(0.3, height * 0.72, -0.1);
    this.bar = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.08), new THREE.MeshBasicMaterial({ color: "#3ddc84", depthTest: false }));
    this.bar.position.y = height + 0.35;
    this.label = nameTag(name, colour);
    this.label.position.y = height + 0.62;
    this.root.add(body, visor, pack, this.gun, this.bar, this.label);
  }

  update(p: { x: number; y: number; z: number; yaw: number; pitch: number }, alive: boolean, healthFraction: number, camera: THREE.Camera): void {
    this.root.visible = alive;
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;
    this.gun.rotation.x = p.pitch;
    this.bar.scale.x = Math.max(healthFraction, 0.001);
    (this.bar.material as THREE.MeshBasicMaterial).color.set(healthFraction > 0.5 ? "#3ddc84" : healthFraction > 0.25 ? "#ffcf3d" : "#ff6b5e");
    this.bar.quaternion.copy(camera.quaternion).premultiply(this.root.quaternion.clone().invert());
  }

  dispose(): void {
    this.root.removeFromParent();
    this.label.material.map?.dispose();
  }
}

function nameTag(name: string, colour: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "700 44px system-ui, sans-serif";
  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(name).width) + 40;
  canvas.height = 64;
  ctx.font = font;
  ctx.fillStyle = "rgba(10, 24, 36, 0.7)";
  ctx.roundRect(0, 0, canvas.width, canvas.height, 16);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.textBaseline = "middle";
  ctx.fillText(name, 20, canvas.height / 2 + 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, sizeAttenuation: false }));
  s.scale.set((canvas.width / canvas.height) * 0.04, 0.04, 1);
  return s;
}

/**
 * The weapon in your hands, bottom right of the view, with a kick when it fires. Drawn
 * in its own pass over the world (so it never pokes into walls or the ground), with its
 * own light.
 */
export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  private readonly root = new THREE.Group();
  private readonly models: Record<string, THREE.Group>;
  private kick = 0;
  private sway = 0;

  constructor() {
    this.scene.add(new THREE.HemisphereLight("#dfefff", "#8a7658", 1.6));
    const key = new THREE.DirectionalLight("#fff4de", 1.8);
    key.position.set(-1, 2, 1);
    this.scene.add(key);
    const dark = new THREE.MeshLambertMaterial({ color: "#5b6972" });
    const light = new THREE.MeshLambertMaterial({ color: "#a9bcc8" });
    const glow = new THREE.MeshBasicMaterial({ color: "#6fe3ff" });
    // Disc launcher: a chunky body with a round magazine and a glowing disc showing.
    const disc = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.42), dark);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 20), light);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, 0.02, -0.06);
    const loaded = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.015, 20), glow);
    loaded.position.set(0, 0.075, -0.06);
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.06), light);
    muzzle.position.set(0, 0.03, -0.22);
    disc.add(body, drum, loaded, muzzle);
    // Assault rifle: long and slim with a magazine.
    const rifle = new THREE.Group();
    const rbody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.48), dark);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 0.05), light);
    mag.position.set(0, -0.08, -0.03);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.07), glow);
    sight.position.set(0, 0.05, 0.04);
    rifle.add(rbody, mag, sight);
    this.models = { disc, rifle };
    for (const m of Object.values(this.models)) this.root.add(m);
    this.root.scale.setScalar(0.8);
    this.root.position.set(0.24, -0.21, -0.62);
    this.root.rotation.y = 0.06;
    this.scene.add(this.root);
    this.show("disc");
  }

  show(id: string): void {
    for (const [k, m] of Object.entries(this.models)) m.visible = k === id;
  }

  fired(strength: number): void {
    this.kick = Math.min(this.kick + strength, 1);
  }

  update(dt: number, visible: boolean, speed: number): void {
    this.root.visible = visible;
    this.kick *= Math.exp(-dt * 12);
    this.sway += dt * Math.min(speed, 12) * 0.9;
    const bob = Math.sin(this.sway) * 0.006 * Math.min(speed / 6, 1);
    this.root.position.set(0.24, -0.21 + bob, -0.62 + this.kick * 0.08);
    this.root.rotation.x = this.kick * 0.2;
  }

  /** Draw over what's already rendered. */
  render(renderer: THREE.WebGLRenderer, aspect: number): void {
    if (!this.root.visible) return;
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }
}
