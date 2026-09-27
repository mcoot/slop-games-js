import { RAPIER, type PhysicsWorld } from "@slop/physics";
import type { LevelMarker } from "@slop/level-loader";
import type { Vec3 } from "@slop/ai";

export interface TrainDoor {
  position: Vec3;
  yaw: number;
  collider: RAPIER.Collider;
  /** 0 open .. 1 closed, for the door animation. */
  closedAmount: number;
}

const DOOR_HALF_WIDTH = 0.65;
const DOOR_HEIGHT = 2.6;

/** The Shinkansen's doors (from `train_door` markers): open until departure, then shut for good. */
export class TrainDoors {
  readonly doors: TrainDoor[];
  closed = false;

  constructor(
    private readonly world: PhysicsWorld,
    markers: LevelMarker[],
  ) {
    this.doors = markers.map((m) => {
      const q = { x: 0, y: Math.sin(m.yaw / 2), z: 0, w: Math.cos(m.yaw / 2) };
      const desc = RAPIER.ColliderDesc.cuboid(DOOR_HALF_WIDTH, DOOR_HEIGHT / 2, 0.08)
        .setTranslation(m.position.x, m.position.y + DOOR_HEIGHT / 2, m.position.z)
        .setRotation(q);
      const collider = world.createCollider(desc);
      collider.setEnabled(false);
      return { position: m.position, yaw: m.yaw, collider, closedAmount: 0 };
    });
  }

  close(): void {
    this.closed = true;
    for (const d of this.doors) d.collider.setEnabled(true);
  }

  reset(): void {
    this.closed = false;
    for (const d of this.doors) {
      d.collider.setEnabled(false);
      d.closedAmount = 0;
    }
  }

  update(dt: number): void {
    for (const d of this.doors) d.closedAmount = Math.min(1, Math.max(0, d.closedAmount + (this.closed ? dt : -dt) / 0.6));
  }

  dispose(): void {
    for (const d of this.doors) this.world.removeCollider(d.collider, false);
  }
}
