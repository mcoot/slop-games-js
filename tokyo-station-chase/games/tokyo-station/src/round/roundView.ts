import * as THREE from "three";
import type { NoiseEvent } from "@slop/ai";
import type { StationRound } from "./stationRound";
import { isNote, type Denomination } from "./yen";

const COIN_COLORS: Partial<Record<Denomination, number>> = {
  1: 0xd8dde3,
  5: 0xd4a93c,
  10: 0xb0673a,
  50: 0xd8dde3,
  100: 0xd8dde3,
  500: 0xd9b45a,
};
const NOTE_COLORS: Partial<Record<Denomination, number>> = { 1000: 0x6f8fb8, 5000: 0xb88fb5, 10000: 0xb89a6f };

/**
 * What the round looks and sounds like: spinning coins and notes, gate flaps,
 * train doors, and machine/gate/pickup sounds for the player.
 */
export class RoundView {
  readonly root = new THREE.Group();
  private readonly yen: THREE.Object3D[] = [];
  private readonly flaps: THREE.Object3D[][] = [];
  private readonly doors: THREE.Mesh[] = [];
  private time = 0;

  constructor(private readonly round: StationRound) {
    for (const p of round.pickups.items) {
      const mesh = isNote(p.value) ? noteMesh(p.value) : coinMesh(p.value);
      mesh.position.set(p.position.x, p.position.y + 0.45, p.position.z);
      this.yen.push(mesh);
      this.root.add(mesh);
    }
    const flapMat = new THREE.MeshStandardMaterial({ color: 0xd24b3a, roughness: 0.5 });
    for (const g of round.gates.gates) {
      const pivot = new THREE.Group();
      pivot.position.set(g.position.x, g.position.y, g.position.z);
      pivot.rotation.y = g.yaw;
      const pair = [-1, 1].map((side) => {
        const hinge = new THREE.Group();
        hinge.position.set(side * 0.6, 0.85, 0);
        const flap = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 0.04), flapMat);
        flap.position.x = -side * 0.275;
        hinge.add(flap);
        pivot.add(hinge);
        return hinge;
      });
      this.flaps.push(pair);
      this.root.add(pivot);
    }
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.4 });
    for (const d of round.doors.doors) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.08), doorMat);
      door.position.set(d.position.x, d.position.y + 1.15, d.position.z);
      door.rotation.y = d.yaw;
      door.userData.open = new THREE.Vector3(d.position.x + 1.3, d.position.y + 1.15, d.position.z);
      door.userData.shut = door.position.clone();
      this.doors.push(door);
      this.root.add(door);
    }
    for (const o of this.root.children) o.traverse((c) => (c.castShadow = true));
  }

  update(frameDt: number): void {
    this.time += frameDt;
    this.round.pickups.items.forEach((p, i) => {
      const m = this.yen[i]!;
      m.visible = !p.taken;
      m.rotation.y = this.time * 2 + i;
      m.position.y = p.position.y + 0.45 + Math.sin(this.time * 3 + i) * 0.06;
    });
    this.round.gates.gates.forEach((g, i) => {
      const [a, b] = this.flaps[i]!;
      a!.rotation.y = g.openAmount * (Math.PI / 2);
      b!.rotation.y = -g.openAmount * (Math.PI / 2);
    });
    this.round.doors.doors.forEach((d, i) => {
      const door = this.doors[i]!;
      // Doors slide sideways into the body; hidden while fully open.
      door.visible = d.closedAmount > 0.01;
      door.position.lerpVectors(door.userData.open, door.userData.shut, d.closedAmount);
    });
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}

function coinMesh(value: Denomination): THREE.Object3D {
  const radius = value === 500 ? 0.16 : value >= 100 ? 0.14 : 0.12;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.03, 20),
    // Not fully metallic: there's no environment map to reflect, so metal would render black.
    new THREE.MeshStandardMaterial({ color: COIN_COLORS[value] ?? 0xcccccc, metalness: 0.25, roughness: 0.35, emissive: COIN_COLORS[value] ?? 0xcccccc, emissiveIntensity: 0.25 }),
  );
  mesh.rotation.x = Math.PI / 2;
  const holder = new THREE.Group();
  holder.add(mesh);
  return holder;
}

function noteMesh(value: Denomination): THREE.Object3D {
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.2, 0.01),
    new THREE.MeshStandardMaterial({ color: NOTE_COLORS[value] ?? 0x88aa88, roughness: 0.8, emissive: 0x111111 }),
  );
}

/** Tiny synthesised sound effects, so the player hears what the chaser hears. */
export class Sfx {
  private ctx: AudioContext | null = null;

  unlock(): void {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
  }

  /** Play something for a noise event near the listener. */
  noise(e: NoiseEvent, listener: THREE.Vector3, volume: number): void {
    const d = Math.hypot(e.position.x - listener.x, e.position.z - listener.z);
    const gain = volume * Math.min(1, 3 / Math.max(d, 1));
    switch (e.kind) {
      case "machine-beep":
        return this.tone([1320], 0.08, gain * 0.25);
      case "machine-coin":
      case "yen":
        return this.tone([2200, 3100], 0.05, gain * 0.2);
      case "machine-note":
        return this.tone([180], 0.3, gain * 0.2, "sawtooth");
      case "machine-print":
        return this.tone([440, 440, 440, 440], 0.12, gain * 0.15, "square");
      case "machine-change":
        return this.tone([2500, 2900, 2300, 3100, 2700], 0.04, gain * 0.2);
      case "gate-beep":
        return this.tone([1760], 0.1, gain * 0.25);
      case "gate-refuse":
        return this.tone([988, 784], 0.18, gain * 0.3);
    }
  }

  /** A sequence of short tones. */
  private tone(freqs: number[], each: number, gain: number, type: OscillatorType = "sine"): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || gain < 0.005) return;
    freqs.forEach((f, i) => {
      const t = ctx.currentTime + i * each * 1.2;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(gain, t);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + each);
      osc.connect(amp).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + each + 0.02);
    });
  }
}
