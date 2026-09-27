/** One Hammer unit in metres (1 inch). A 72-unit Source player hull is 1.83 m. */
export const SOURCE_UNIT = 0.0254;
export const u = (units: number) => units * SOURCE_UNIT;

export interface MovementSettings {
  /** Top ground speed when running (m/s). */
  runSpeed: number;
  /** Top ground speed while holding walk (m/s). */
  walkSpeed: number;
  /** Multiplier on ground speed while crouched. */
  crouchSpeedFactor: number;
  /** Ground acceleration (Source sv_accelerate). */
  accelerate: number;
  /** Air acceleration (Source sv_airaccelerate). Higher = easier air strafing. */
  airAccelerate: number;
  /** Wish-speed cap while airborne (m/s). Source hard-codes 30 units. This is what makes strafe-jumping gain speed. */
  airSpeedCap: number;
  /** Ground friction (Source sv_friction). */
  friction: number;
  /** Below this speed friction acts as if you were going this fast, so you stop crisply (Source sv_stopspeed). */
  stopSpeed: number;
  /** m/s². Source default 800 u/s² ≈ 20.3 m/s². */
  gravity: number;
  /** Upward speed given by a jump (m/s). Jump height = v² / 2g. */
  jumpSpeed: number;
  /** Jump again automatically while jump is held on landing. Off in Source: you have to time it or use the scroll wheel. */
  autoBhop: boolean;
  /**
   * If > 0, a jump clamps horizontal speed to this multiple of the current max speed (Half-Life 2 uses 1.1).
   * 0 leaves bunny-hopping uncapped.
   */
  bhopSpeedCap: number;
  /** Tallest ledge you walk up without jumping (m). Source: 18 units. */
  stepHeight: number;
  /** Steepest slope you can stand on, in degrees. Source: normal.y >= 0.7, about 45.6°. */
  maxWalkableSlopeDeg: number;
  /** Half the hull's width (m). */
  hullHalfWidth: number;
  standHeight: number;
  crouchHeight: number;
  standEyeHeight: number;
  crouchEyeHeight: number;
  /** Seconds for the view to lower when crouching on the ground. */
  duckTime: number;
}

export const tokyoMovement: MovementSettings = {
  runSpeed: 6.0,
  walkSpeed: 2.8,
  crouchSpeedFactor: 0.34,
  accelerate: 5.5,
  airAccelerate: 12,
  airSpeedCap: u(30),
  friction: 4.8,
  stopSpeed: u(75),
  gravity: u(800),
  jumpSpeed: 6.4,
  autoBhop: false,
  bhopSpeedCap: 0,
  stepHeight: 0.45,
  maxWalkableSlopeDeg: 45.57,
  hullHalfWidth: 0.33,
  standHeight: u(72),
  crouchHeight: 1.17,
  standEyeHeight: u(64),
  crouchEyeHeight: u(64) - (u(72) - 1.17),
  duckTime: 0.2,
};

export const movementPresets: Record<string, MovementSettings> = {
  "Tokyo default": tokyoMovement,
  "Counter-Strike: Source-like": {
    ...tokyoMovement,
    runSpeed: u(250),
    walkSpeed: u(250 * 0.52),
    accelerate: 5,
    airAccelerate: 10,
    friction: 4,
    stopSpeed: u(75),
    gravity: u(800),
    jumpSpeed: u(301.993),
    bhopSpeedCap: 0,
    stepHeight: u(18),
  },
  "Half-Life 2-like": {
    ...tokyoMovement,
    runSpeed: u(320),
    walkSpeed: u(150),
    accelerate: 10,
    airAccelerate: 10,
    friction: 4,
    stopSpeed: u(100),
    gravity: u(600),
    jumpSpeed: u(Math.sqrt(2 * 600 * 21)),
    bhopSpeedCap: 1.1,
    stepHeight: u(18),
  },
};
