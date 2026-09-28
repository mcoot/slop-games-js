import { movementPresets, u, type MovementSettings } from "@slop/fps-controller";

/**
 * Bondi's own movement: Tribes-style skiing on the Source controller. Tokyo's feel is
 * untouched: these only change this game's settings.
 *
 * - Hold ski (Space) on the ground: no friction, gravity carries you down slopes and
 *   your momentum up the next one; you take off over crests and keep your speed
 *   landing on a downslope.
 * - A little lighter than Source, so jets and jumps hang a bit.
 * - More air control than Source (a bigger air speed cap), for steering in flight.
 * - Standing limit stays Source's 45.6°: cliffs are too steep to stand on, you slide.
 */
export const bondiSkiMovement: MovementSettings = {
  ...movementPresets["Counter-Strike: Source-like"]!,
  accelerate: 8,
  airAccelerate: 6,
  airSpeedCap: 2.5,
  friction: 4,
  gravity: 16,
  jumpSpeed: 6.2,
  autoBhop: false,
  bhopSpeedCap: 0,
  stepHeight: u(18),
  maxWalkableSlopeDeg: 45.57,
  skiFriction: 0.03,
};

export const bondiMovementPresets: Record<string, MovementSettings> = {
  "Bondi ski": bondiSkiMovement,
  // Air control to compare: how much you can steer while skiing or flying.
  "Bondi ski, loose (Tribes 1-ish)": { ...bondiSkiMovement, airAccelerate: 3, airSpeedCap: 1.5 },
  "Bondi ski, tight": { ...bondiSkiMovement, airAccelerate: 12, airSpeedCap: 4.5 },
  "Bondi ski, grippy ground": { ...bondiSkiMovement, accelerate: 12, friction: 6, runSpeed: u(270) },
  "Bondi ski, Source gravity": { ...bondiSkiMovement, gravity: u(800) },
  ...movementPresets,
};
