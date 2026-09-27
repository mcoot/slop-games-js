import * as THREE from "three";
import type { Chaser } from "@slop/ai";

/**
 * How the chaser looks and sounds: a greybox salaryman (capsule body, head, a hint
 * of a tie) that bobs as it runs, and footsteps that get louder and pan as it closes in.
 */
export class ChaserView {
  readonly root = new THREE.Group();
  private readonly figure = new THREE.Group();
  private bobPhase = 0;
  private stepDistance = 0;
  private audio: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  constructor(height: number, radius: number) {
    const suit = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9b89a, roughness: 0.7 });
    const tie = new THREE.MeshStandardMaterial({ color: 0xa3232e, roughness: 0.6 });
    const headRadius = 0.13;
    const bodyHeight = height - headRadius * 2 - 0.05;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(radius * 0.8, bodyHeight - radius * 1.6, 6, 12), suit);
    body.position.y = bodyHeight / 2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(headRadius, 16, 12), skin);
    head.position.y = height - headRadius;
    const tieMesh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, 0.02), tie);
    tieMesh.position.set(0, bodyHeight - 0.35, -radius * 0.8);
    for (const m of [body, head, tieMesh]) {
      m.castShadow = true;
      m.userData.collider = "none";
    }
    this.figure.add(body, head, tieMesh);
    this.root.add(this.figure);
  }

  /** Call when the page gets a user gesture, so audio is allowed to start. */
  unlockAudio(): void {
    if (!this.audio) {
      this.audio = new AudioContext();
      const len = Math.floor(this.audio.sampleRate * 0.12);
      this.noise = this.audio.createBuffer(1, len, this.audio.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    void this.audio.resume();
  }

  update(chaser: Chaser, alpha: number, frameDt: number, listener: THREE.Camera, volume: number): void {
    const p0 = chaser.body.prevFeet;
    const p1 = chaser.body.feet;
    this.root.position.set(
      THREE.MathUtils.lerp(p0.x, p1.x, alpha),
      THREE.MathUtils.lerp(p0.y, p1.y, alpha),
      THREE.MathUtils.lerp(p0.z, p1.z, alpha),
    );
    this.root.rotation.y = chaser.facing;

    const speed = chaser.body.horizontalSpeed;
    this.bobPhase += speed * frameDt * 1.9;
    this.figure.position.y = Math.abs(Math.sin(this.bobPhase)) * 0.05 * Math.min(speed / 5, 1);
    this.figure.rotation.x = -Math.min(speed / 7, 1) * 0.18; // lean into the run

    if (chaser.body.grounded && speed > 0.5) {
      this.stepDistance += speed * frameDt;
      if (this.stepDistance > 1.6) {
        this.stepDistance = 0;
        this.footstep(listener, volume);
      }
    }
  }

  private footstep(listener: THREE.Camera, volume: number): void {
    const ctx = this.audio;
    if (!ctx || !this.noise || ctx.state !== "running" || volume <= 0) return;
    const toChaser = this.root.position.clone().sub(listener.position);
    const distance = toChaser.length();
    const gain = volume * Math.min(1, 6 / Math.max(distance, 1)) ** 1.3;
    if (gain < 0.01) return;
    // Pan by which side of the listener it's on.
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(listener.quaternion);
    const pan = THREE.MathUtils.clamp(toChaser.normalize().dot(right), -1, 1);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.3;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500 + 1500 * Math.min(1, 8 / Math.max(distance, 1));
    const amp = ctx.createGain();
    amp.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan * 0.8;
    src.connect(filter).connect(amp).connect(panner).connect(ctx.destination);
    src.start();
  }
}
