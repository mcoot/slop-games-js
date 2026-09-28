import { RAPIER, type PhysicsWorld } from "@slop/physics";
import type { PlayerController } from "@slop/fps-controller";
import type { Vec3 } from "./navigation";

/** Something that can be heard within `radius` metres (in the open; walls muffle it). */
export interface NoiseEvent {
  position: Vec3;
  radius: number;
  /** What made it, for debugging ("footstep", "landing", "ticket-machine"...). */
  kind: string;
}

/** Collects noises during a tick for listeners to read. */
export class NoiseBus {
  private events: NoiseEvent[] = [];

  emit(event: NoiseEvent): void {
    this.events.push(event);
  }

  /** The noises since the last drain. */
  drain(): NoiseEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}

/**
 * Is the straight line between two points clear of solid geometry? Sensors and the
 * colliders in `ignore` (the looker and the target themselves) don't block.
 */
export function lineOfSight(world: PhysicsWorld, from: Vec3, to: Vec3, ignore: number[]): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-4) return true;
  const ray = new RAPIER.Ray(from, { x: dx / length, y: dy / length, z: dz / length });
  const hit = world.castRay(
    ray,
    length,
    true,
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    undefined,
    undefined,
    undefined,
    (c) => !ignore.includes(c.handle),
  );
  return hit === null;
}

export interface MovementNoiseSettings {
  /** Hearing radius of a running footstep (m). */
  runRadius: number;
  /** Walking (Shift). */
  walkRadius: number;
  crouchRadius: number;
  /** Landing noise radius per m/s of impact speed. A normal jump lands at ~6.4 m/s. */
  landingRadiusPerSpeed: number;
  /** Take-off. */
  jumpRadius: number;
  /** Metres between footsteps. */
  stride: number;
}

export const defaultMovementNoise: MovementNoiseSettings = {
  runRadius: 15,
  walkRadius: 2,
  crouchRadius: 1,
  landingRadiusPerSpeed: 3,
  jumpRadius: 8,
  stride: 1.7,
};

/** Turns a character's movement into noise: footsteps, jumps and landings. */
export class MovementNoise {
  private travelled = 0;

  constructor(public settings: MovementNoiseSettings = { ...defaultMovementNoise }) {}

  /** Call once per tick after the controller's tick. */
  update(body: PlayerController, bus: NoiseBus): void {
    const s = this.settings;
    const feet = { x: body.feet.x, y: body.feet.y, z: body.feet.z };
    const ev = body.events;
    if (ev.jumped) bus.emit({ position: feet, radius: s.jumpRadius, kind: "jump" });
    if (ev.landedSpeed > 1) bus.emit({ position: feet, radius: ev.landedSpeed * s.landingRadiusPerSpeed, kind: "landing" });
    if (!body.grounded) return;
    this.travelled += Math.hypot(body.feet.x - body.prevFeet.x, body.feet.z - body.prevFeet.z);
    if (this.travelled < s.stride) return;
    this.travelled %= s.stride;
    const walking = body.horizontalSpeed <= body.settings.walkSpeed * 1.15;
    const radius = body.ducked ? s.crouchRadius : walking ? s.walkRadius : s.runRadius;
    bus.emit({ position: feet, radius, kind: "footstep" });
  }
}
