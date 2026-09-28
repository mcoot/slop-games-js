import { RAPIER, type PhysicsWorld } from "@slop/physics";
import { PlayerController, type MoveCommand, type MovementSettings } from "@slop/fps-controller";
import { Jetpack } from "../jetpack";
import type { V3 } from "./damage";
import { Fighter } from "./fighter";

export interface BotSettings {
  /** Aim wobble (radians). */
  aimError: number;
  /** Seconds between noticing you and shooting. */
  reaction: number;
  /** Furthest they'll shoot from (m). */
  range: number;
}

export const defaultBotSettings: BotSettings = { aimError: 0.07, reaction: 0.8, range: 90 };

export interface Enemy {
  id: string;
  feet: V3;
  velocity: V3;
  alive: boolean;
}

/**
 * A deliberately simple opponent for practice: heads for the nearest enemy, skis
 * downhill and jets uphill on the way, strafes and hops when close, and fires discs
 * at your feet with a rough lead. Local only (it isn't sent to anyone else).
 */
export class Bot {
  readonly body: PlayerController;
  readonly fighter = new Fighter();
  readonly jet = new Jetpack();
  yaw = 0;
  pitch = 0;
  private strafe = 1;
  private strafeTimer = 0;
  private seen = 0;
  private random: () => number;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly colour: string,
    private readonly world: PhysicsWorld,
    movement: MovementSettings,
    spawn: V3,
    public settings: BotSettings = defaultBotSettings,
    seed = 1,
  ) {
    this.body = new PlayerController(world, { ...movement }, spawn);
    let s = seed * 9301 + 49297;
    this.random = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  }

  eye(): V3 {
    const f = this.body.feet;
    return { x: f.x, y: f.y + this.body.eyeHeight, z: f.z };
  }

  /** Decide this tick's movement and whether to fire. `ignore` are colliders sight passes through. */
  think(dt: number, enemies: Enemy[], ignore: Set<number>): { cmd: MoveCommand; jet: boolean; fire: boolean; aim: V3 } {
    const me = this.body.feet;
    let target: Enemy | null = null;
    let best = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.feet.x - me.x, e.feet.y - me.y, e.feet.z - me.z);
      if (d < best) {
        best = d;
        target = e;
      }
    }
    const idle: MoveCommand = { forward: 0, side: 0, jumpPresses: 0, jumpHeld: false, crouch: false, walk: false, yaw: this.yaw, ski: false };
    if (!target) return { cmd: idle, jet: false, fire: false, aim: { x: 0, y: 0, z: -1 } };

    // Lead the target for the disc's flight time, and aim at their feet for splash.
    const eye = this.eye();
    const flight = best / 62;
    const aimAt = {
      x: target.feet.x + target.velocity.x * flight,
      y: target.feet.y + 0.2 + Math.min(target.velocity.y, 0) * flight * 0.5,
      z: target.feet.z + target.velocity.z * flight,
    };
    const dx = aimAt.x - eye.x;
    const dy = aimAt.y - eye.y;
    const dz = aimAt.z - eye.z;
    const err = this.settings.aimError;
    this.yaw = Math.atan2(-dx, -dz) + (this.random() - 0.5) * 2 * err;
    this.pitch = Math.atan2(dy, Math.hypot(dx, dz)) + (this.random() - 0.5) * 2 * err;
    const cp = Math.cos(this.pitch);
    const aim = { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };

    const visible = this.lineOfSight(eye, { x: target.feet.x, y: target.feet.y + 1.2, z: target.feet.z }, ignore);
    this.seen = visible ? this.seen + dt : 0;

    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafe = this.random() < 0.5 ? -1 : 1;
      this.strafeTimer = 0.8 + this.random() * 1.5;
    }
    const close = best < 45;
    const speed = this.body.horizontalSpeed;
    const cmd: MoveCommand = {
      ...idle,
      forward: close ? 0.3 : 1,
      side: close ? this.strafe : 0,
      jumpPresses: close && this.random() < dt * 0.8 ? 1 : 0,
      ski: speed > 7 && !close,
      yaw: this.yaw,
    };
    const climbing = target.feet.y > me.y + 3;
    // Jet to climb, to dodge up close, and in long hops to cover ground.
    const travelling = best > 80 && this.jet.energy > 0.6;
    const jet = this.jet.energy > (this.jet.active ? 0.05 : 0.4) && (climbing || travelling || (close && this.random() < 0.3));
    const fire = visible && this.seen > this.settings.reaction && best < this.settings.range && this.fighter.weapon.ready;
    return { cmd, jet, fire, aim };
  }

  private lineOfSight(from: V3, to: V3, ignore: Set<number>): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    const hit = this.world.castRay(
      new RAPIER.Ray(from, { x: dx / len, y: dy / len, z: dz / len }),
      len,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      undefined,
      (c) => !ignore.has(c.handle),
    );
    return hit === null;
  }

  dispose(): void {
    this.body.dispose();
  }
}
