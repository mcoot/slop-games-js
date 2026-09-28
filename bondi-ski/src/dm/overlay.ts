import * as THREE from "three";

export interface LabelItem {
  id: string;
  name: string;
  colour: string;
  /** Top of their head. */
  pos: THREE.Vector3;
  health: number;
  maxHealth: number;
  /** In sight (not behind the hill). */
  visible: boolean;
}

interface Floater {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  drift: number;
}

const FLOAT_TIME = 1.1;

/**
 * Screen-space labels over the world: a name and health bar over each enemy you can
 * see, and damage numbers that float up from where you hit someone.
 */
export class WorldOverlay {
  private readonly root: HTMLElement;
  private readonly labels = new Map<string, HTMLElement>();
  private readonly floaters: Floater[] = [];
  private readonly v = new THREE.Vector3();

  constructor() {
    this.root = document.querySelector<HTMLElement>("#labels")!;
  }

  /** A damage number at `pos`: yellow for a midair, big and red for a kill. */
  damage(pos: THREE.Vector3, amount: number, kind: "hit" | "midair" | "kill"): void {
    const el = document.createElement("div");
    el.className = `dmg ${kind}`;
    el.textContent = String(Math.round(amount));
    this.root.append(el);
    this.floaters.push({ el, pos: pos.clone(), age: 0, drift: (Math.random() - 0.5) * 0.8 });
  }

  update(camera: THREE.Camera, width: number, height: number, items: LabelItem[], dt: number): void {
    const seen = new Set<string>();
    for (const it of items) {
      const at = this.project(camera, it.pos, width, height);
      const dist = camera.position.distanceTo(it.pos);
      if (!at || !it.visible || dist > 220) continue;
      seen.add(it.id);
      let el = this.labels.get(it.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "enemy";
        el.innerHTML = `<span class="name"></span><div class="bar"><div class="fill"></div></div>`;
        this.root.append(el);
        this.labels.set(it.id, el);
      }
      const name = el.querySelector<HTMLElement>(".name")!;
      if (name.textContent !== it.name) name.textContent = it.name;
      name.style.color = it.colour;
      const f = Math.max(it.health / it.maxHealth, 0);
      const fill = el.querySelector<HTMLElement>(".fill")!;
      fill.style.width = `${Math.round(f * 100)}%`;
      fill.style.background = f > 0.5 ? "#3ddc84" : f > 0.25 ? "#ffcf3d" : "#ff6b5e";
      // Shrink a little with distance, but stay readable.
      const scale = Math.max(0.6, Math.min(1, 40 / dist + 0.4));
      el.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -100%) scale(${scale.toFixed(2)})`;
    }
    for (const [id, el] of this.labels) {
      if (seen.has(id)) continue;
      el.remove();
      this.labels.delete(id);
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const fl = this.floaters[i]!;
      fl.age += dt;
      const t = fl.age / FLOAT_TIME;
      const at = this.project(camera, this.v.copy(fl.pos).add(new THREE.Vector3(0, 0.6 + t * 1.4, 0)), width, height);
      if (t >= 1 || !at) {
        if (t >= 1) {
          fl.el.remove();
          this.floaters.splice(i, 1);
        } else {
          fl.el.style.opacity = "0";
        }
        continue;
      }
      fl.el.style.opacity = String(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
      fl.el.style.transform = `translate(${at.x + fl.drift * 40 * t}px, ${at.y}px) translate(-50%, -50%) scale(${(1.2 - t * 0.3).toFixed(2)})`;
    }
  }

  clear(): void {
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
    for (const f of this.floaters) f.el.remove();
    this.floaters.length = 0;
  }

  private project(camera: THREE.Camera, p: THREE.Vector3, width: number, height: number): { x: number; y: number } | null {
    const v = this.v.copy(p).project(camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height };
  }
}
