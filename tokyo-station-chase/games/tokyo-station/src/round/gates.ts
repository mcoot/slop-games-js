import { RAPIER, type PhysicsWorld } from "@slop/physics";
import type { LevelMarker } from "@slop/level-loader";
import type { NoiseBus, Vec3 } from "@slop/ai";

export interface Gate {
  position: Vec3;
  yaw: number;
  collider: RAPIER.Collider;
  open: boolean;
  /** 0 closed .. 1 open, for the flap animation. */
  openAmount: number;
  /** Seconds since someone allowed was last in range. */
  idle: number;
  refuseCooldown: number;
}

export interface GateEvents {
  opened: Gate[];
  refused: Gate[];
}

/** Half the passage width the flaps span (m), and how high the (invisible) barrier goes. */
const HALF_WIDTH = 0.6;
const BARRIER_HEIGHT = 2.3;
/** How close you must be to open or be refused (m). */
const OPEN_RANGE = 1.6;
const REFUSE_RANGE = 0.9;
const CLOSE_AFTER = 0.8;

/**
 * Ticket gates from `gate` markers (on the floor in the middle of a passage, facing
 * along it). Closed flaps block the whole passage height; they open for anyone with a
 * ticket, and for the chaser (staff don't stop him). Without a ticket they stay shut
 * and chime.
 */
export class GateLine {
  readonly gates: Gate[];

  constructor(
    private readonly world: PhysicsWorld,
    markers: LevelMarker[],
  ) {
    this.gates = markers.map((m) => {
      const q = { x: 0, y: Math.sin(m.yaw / 2), z: 0, w: Math.cos(m.yaw / 2) };
      const desc = RAPIER.ColliderDesc.cuboid(HALF_WIDTH, BARRIER_HEIGHT / 2, 0.05)
        .setTranslation(m.position.x, m.position.y + BARRIER_HEIGHT / 2, m.position.z)
        .setRotation(q);
      return {
        position: m.position,
        yaw: m.yaw,
        collider: world.createCollider(desc),
        open: false,
        openAmount: 0,
        idle: 0,
        refuseCooldown: 0,
      };
    });
  }

  reset(): void {
    for (const g of this.gates) this.setOpen(g, false);
  }

  dispose(): void {
    for (const g of this.gates) this.world.removeCollider(g.collider, false);
  }

  update(dt: number, player: Vec3, hasTicket: boolean, chaser: Vec3 | null, bus: NoiseBus): GateEvents {
    const events: GateEvents = { opened: [], refused: [] };
    for (const g of this.gates) {
      const playerDist = Math.hypot(player.x - g.position.x, player.z - g.position.z);
      const chaserNear = chaser !== null && Math.hypot(chaser.x - g.position.x, chaser.z - g.position.z) < OPEN_RANGE;
      const forPlayer = hasTicket && playerDist < OPEN_RANGE;
      const allowed = forPlayer || chaserNear;
      g.refuseCooldown -= dt;
      if (allowed) {
        g.idle = 0;
        if (!g.open) {
          this.setOpen(g, true);
          events.opened.push(g);
          // Only a ticket beeps (he waves a pass), so he doesn't hear himself.
          if (forPlayer) bus.emit({ position: { ...g.position }, radius: 8, kind: "gate-beep" });
        }
      } else if (g.open) {
        g.idle += dt;
        if (g.idle > CLOSE_AFTER) this.setOpen(g, false);
      } else if (!hasTicket && playerDist < REFUSE_RANGE && g.refuseCooldown <= 0) {
        g.refuseCooldown = 1.5;
        events.refused.push(g);
        bus.emit({ position: { ...g.position }, radius: 10, kind: "gate-refuse" });
      }
      g.openAmount = Math.min(1, Math.max(0, g.openAmount + (g.open ? dt : -dt) / 0.25));
    }
    return events;
  }

  private setOpen(g: Gate, open: boolean): void {
    g.open = open;
    g.idle = 0;
    g.collider.setEnabled(!open);
  }
}
