import type { PlayerController, Vec3 } from "@slop/fps-controller";

/**
 * A Tribes jetpack: thrust up (and a little the way you're steering) while you hold it,
 * limited by energy that recharges when you let go.
 */
export interface JetSettings {
  /** Upward thrust (m/s²); a bit more than gravity, so you climb gently. */
  thrust: number;
  /** The jets stop pushing up once you're rising this fast (m/s), so they lift rather than launch. */
  maxRise: number;
  /** Thrust along your steering direction (m/s²). */
  forwardThrust: number;
  /** ...until you're going this fast that way (m/s): jets help you along, skiing makes you fast. */
  maxForward: number;
  /** Energy used per second of thrust (a full tank is 1). */
  drain: number;
  /** Energy regained per second when not thrusting. */
  recharge: number;
}

export const defaultJet: JetSettings = { thrust: 22, maxRise: 8, forwardThrust: 7, maxForward: 16, drain: 0.4, recharge: 0.22 };

/** Upward speed that counts as leaving the ground (Source's 140 u/s, plus a margin). */
const LIFT_OFF = 3.8;

export class Jetpack {
  energy = 1;
  /** Thrusting this tick. */
  active = false;

  constructor(public settings: JetSettings = { ...defaultJet }) {}

  reset(): void {
    this.energy = 1;
    this.active = false;
  }

  /** Call before the player's tick. `wishDir` is the horizontal steering direction (unit, or zero). */
  tick(player: PlayerController, held: boolean, wishDir: Vec3, dt: number): void {
    const s = this.settings;
    this.active = held && this.energy > 0;
    if (!this.active) {
      this.energy = Math.min(this.energy + s.recharge * dt, 1);
      return;
    }
    this.energy = Math.max(this.energy - s.drain * dt, 0);
    const v = player.velocity;
    if (player.grounded) {
      // Leave the ground: the controller treats anything rising this fast as airborne.
      v.y = Math.max(v.y, LIFT_OFF);
      player.grounded = false;
    }
    if (v.y < s.maxRise) v.y = Math.min(v.y + s.thrust * dt, Math.max(s.maxRise, v.y));
    if (v.x * wishDir.x + v.z * wishDir.z < s.maxForward) {
      v.x += wishDir.x * s.forwardThrust * dt;
      v.z += wishDir.z * s.forwardThrust * dt;
    }
  }
}
