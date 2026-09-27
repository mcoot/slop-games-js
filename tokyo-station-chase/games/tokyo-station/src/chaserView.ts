import * as THREE from "three";
import type { Chaser } from "@slop/ai";

/**
 * How the chaser looks and sounds: a greybox salaryman (capsule body, head, a hint
 * of a tie) that bobs as it runs; its footsteps are reported through `onStep`.
 */
export class ChaserView {
  readonly root = new THREE.Group();
  private readonly figure = new THREE.Group();
  private bobPhase = 0;
  private stepDistance = 0;
  /** Called for each footstep, with where it landed and how hard (0..1). */
  onStep: ((position: THREE.Vector3, weight: number) => void) | null = null;

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

  update(chaser: Chaser, alpha: number, frameDt: number): void {
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
        this.onStep?.(this.root.position.clone(), Math.min(1, speed / 5));
      }
    }
  }
}
