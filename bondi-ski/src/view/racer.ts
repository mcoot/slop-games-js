import * as THREE from "three";

/**
 * Another racer drawn in the world: your best run's ghost for now, and later remote
 * players fed from the network. A translucent figure with a fading trail.
 */
export class RacerView {
  readonly root = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly trail: THREE.Line;
  private readonly trailPoints: THREE.Vector3[] = [];

  constructor(colour: string, height: number) {
    const material = new THREE.MeshLambertMaterial({ color: colour, transparent: true, opacity: 0.55, emissive: colour, emissiveIntensity: 0.35, depthWrite: false });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, height - 0.6, 4, 10), material);
    this.body.position.y = height / 2;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.2), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
    visor.position.set(0, height - 0.35, -0.25);
    this.root.add(this.body, visor);
    const trailGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.trail = new THREE.Line(trailGeom, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.5 }));
    this.trail.frustumCulled = false;
  }

  /** Add to a scene (the trail lives in world space, outside the figure). */
  addTo(scene: THREE.Object3D): void {
    scene.add(this.root, this.trail);
  }

  set visible(v: boolean) {
    this.root.visible = v;
    this.trail.visible = v;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  update(x: number, y: number, z: number, yaw: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    const last = this.trailPoints.at(-1);
    const p = new THREE.Vector3(x, y + 1, z);
    if (!last || last.distanceToSquared(p) > 0.5) {
      if (last && last.distanceToSquared(p) > 400) this.trailPoints.length = 0; // teleported
      this.trailPoints.push(p);
      if (this.trailPoints.length > 90) this.trailPoints.shift();
      this.trail.geometry.setFromPoints(this.trailPoints.length > 1 ? this.trailPoints : [p, p]);
    }
  }

  clearTrail(): void {
    this.trailPoints.length = 0;
  }
}
