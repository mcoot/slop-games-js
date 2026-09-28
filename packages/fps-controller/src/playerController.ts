import RAPIER from "@dimforge/rapier3d-compat";
import {
  accelerate,
  airAccelerate,
  applyFriction,
  clipVelocityToPlanes,
  horizontalSpeed,
  yawBasis,
  type Vec3,
} from "./pmove";
import type { MovementSettings } from "./settings";

export interface MoveCommand {
  /** -1..1, positive = forward. */
  forward: number;
  /** -1..1, positive = right. */
  side: number;
  /** Jump presses since the last tick (keyboard press or wheel notch). */
  jumpPresses: number;
  jumpHeld: boolean;
  crouch: boolean;
  walk: boolean;
  /** View yaw in radians, same convention as MouseLook. */
  yaw: number;
}

/** Things that happened during the last tick, for camera and audio feedback. */
export interface MoveEvents {
  jumped: boolean;
  /** Downward speed at the moment of landing (m/s), or 0 if we didn't land. */
  landedSpeed: number;
  /** Sudden vertical change from a stair step or ledge snap (m), for view smoothing. */
  stepDelta: number;
}

/** Upward speed above which we never count as on the ground (Source: 140 units/s). */
const NON_JUMP_VELOCITY = 3.56;
/** How far below the hull we look for ground each tick. */
const GROUND_PROBE = 0.04;
/** Rapier's skin: the hull hovers this far from what it touches. */
const SKIN = 0.01;
const UP = { x: 0, y: 1, z: 0 };
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Source-style kinematic player. Rapier handles collision and stepping;
 * velocity, friction, acceleration, jumping, ducking and ground detection
 * follow the Source rules.
 *
 * Position is the centre of the bottom of the hull ("feet"), like Source's origin.
 */
export class PlayerController {
  readonly feet: RAPIER.Vector3;
  readonly prevFeet: RAPIER.Vector3;
  readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  grounded = false;
  groundNormal: Vec3 = { ...UP };
  ducked = false;
  /** Current eye height above the feet (smoothed while ducking). */
  eyeHeight: number;
  prevEyeHeight: number;
  readonly events: MoveEvents = { jumped: false, landedSpeed: 0, stepDelta: 0 };
  /**
   * Optional correction of contact normals, given what was hit and the contact point on it.
   * Where a hull edge crosses the edge between two triangles of a mesh, Rapier can report a
   * normal belonging to neither; on a smoothly curving surface (a surf ramp) clipping
   * against it bleeds speed. A game that knows the true surface can return its normal.
   */
  contactNormal: ((normal: Vec3, point: Vec3, collider: RAPIER.Collider) => Vec3) | null = null;

  private readonly collider: RAPIER.Collider;
  private readonly kcc: RAPIER.KinematicCharacterController;
  private shapeCache: RAPIER.Cuboid | null = null;
  /** Seconds since we crouched while standing on the ground (Infinity if not). */
  private groundDuckAge = Infinity;

  constructor(
    private readonly world: RAPIER.World,
    public settings: MovementSettings,
    spawn: Vec3,
  ) {
    this.feet = new RAPIER.Vector3(spawn.x, spawn.y, spawn.z);
    this.prevFeet = new RAPIER.Vector3(spawn.x, spawn.y, spawn.z);
    this.eyeHeight = this.prevEyeHeight = settings.standEyeHeight;
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(settings.hullHalfWidth, settings.standHeight / 2, settings.hullHalfWidth),
    );
    this.collider.setTranslation(this.center());
    this.kcc = world.createCharacterController(SKIN);
    this.kcc.setUp(UP);
    this.kcc.setSlideEnabled(true);
    this.kcc.disableSnapToGround(); // we do Source's StayOnGround ourselves
    this.kcc.disableAutostep(); // and Source's StepMove
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.applySettings();
  }

  /** Call after changing `settings` (e.g. from the tuning panel). */
  applySettings(): void {
    const slope = (this.settings.maxWalkableSlopeDeg * Math.PI) / 180;
    this.kcc.setMaxSlopeClimbAngle(slope);
    this.kcc.setMinSlopeSlideAngle(slope);
    this.collider.setHalfExtents({
      x: this.settings.hullHalfWidth,
      y: this.hullHeight() / 2,
      z: this.settings.hullHalfWidth,
    });
    this.collider.setTranslation(this.center());
  }

  /** Handle of the hull collider, e.g. to exclude it from line-of-sight rays. */
  get colliderHandle(): number {
    return this.collider.handle;
  }

  get horizontalSpeed(): number {
    return horizontalSpeed(this.velocity);
  }

  get minWalkNormalY(): number {
    return Math.cos((this.settings.maxWalkableSlopeDeg * Math.PI) / 180);
  }

  hullHeight(ducked = this.ducked): number {
    return ducked ? this.settings.crouchHeight : this.settings.standHeight;
  }

  teleport(p: Vec3, resetVelocity = true): void {
    this.feet.x = this.prevFeet.x = p.x;
    this.feet.y = this.prevFeet.y = p.y;
    this.feet.z = this.prevFeet.z = p.z;
    if (resetVelocity) {
      this.velocity.x = this.velocity.y = this.velocity.z = 0;
    }
    this.grounded = false;
    this.collider.setTranslation(this.center());
  }

  dispose(): void {
    this.world.removeCharacterController(this.kcc);
    this.world.removeCollider(this.collider, false);
  }

  tick(cmd: MoveCommand, dt: number): void {
    const s = this.settings;
    const ev = this.events;
    ev.jumped = false;
    ev.landedSpeed = 0;
    ev.stepDelta = 0;
    this.prevFeet.x = this.feet.x;
    this.prevFeet.y = this.feet.y;
    this.prevFeet.z = this.feet.z;
    this.prevEyeHeight = this.eyeHeight;

    this.updateDuck(cmd.crouch, dt);

    // Wish direction and speed from input.
    const { forward, right } = yawBasis(cmd.yaw);
    const wx = forward.x * cmd.forward + right.x * cmd.side;
    const wz = forward.z * cmd.forward + right.z * cmd.side;
    const wlen = Math.hypot(wx, wz);
    const wishDir = wlen > 0 ? { x: wx / wlen, y: 0, z: wz / wlen } : { x: 0, y: 0, z: 0 };
    let maxSpeed = cmd.walk ? s.walkSpeed : s.runSpeed;
    if (this.ducked && this.grounded) maxSpeed *= s.crouchSpeedFactor;
    const wishSpeed = wlen > 0 ? maxSpeed : 0;

    // Jump before friction, so landing and jumping in the same tick loses no speed.
    const wantsJump = cmd.jumpPresses > 0 || (s.autoBhop && cmd.jumpHeld);
    if (wantsJump && this.grounded) {
      if (s.bhopSpeedCap > 0) {
        const cap = s.bhopSpeedCap * maxSpeed;
        const hs = horizontalSpeed(this.velocity);
        if (hs > cap) {
          this.velocity.x *= cap / hs;
          this.velocity.z *= cap / hs;
        }
      }
      this.velocity.y = s.jumpSpeed;
      this.grounded = false;
      ev.jumped = true;
      // Crouch and jump pressed together: Source is still mid-duck when you leave the
      // ground, so the duck finishes in the air and lifts your legs. Do the same.
      const diff = s.standHeight - s.crouchHeight;
      if (this.ducked && this.groundDuckAge < s.duckTime && this.fits(s.crouchHeight, this.feet.y + diff)) {
        this.setFeet({ x: this.feet.x, y: this.feet.y + diff, z: this.feet.z });
        this.prevFeet.y += diff;
        this.eyeHeight -= diff;
        this.prevEyeHeight -= diff;
      }
      this.groundDuckAge = Infinity;
    }

    if (this.grounded) {
      this.velocity.y = 0;
      applyFriction(this.velocity, s.friction, s.stopSpeed, dt);
      accelerate(this.velocity, wishDir, wishSpeed, s.accelerate, dt);
    } else {
      airAccelerate(this.velocity, wishDir, wishSpeed, s.airAccelerate, s.airSpeedCap, dt);
      // Half the gravity before the move and half after gives an exact parabola.
      this.velocity.y -= s.gravity * dt * 0.5;
    }

    const wasGrounded = this.grounded;
    const fallSpeed = -this.velocity.y;
    this.move(dt);

    if (!this.grounded) this.velocity.y -= s.gravity * dt * 0.5;

    this.categorizePosition();
    if (wasGrounded && !this.grounded && !ev.jumped) this.stayOnGround();
    if (!wasGrounded && this.grounded) {
      ev.landedSpeed = Math.max(fallSpeed, 0);
      this.velocity.y = 0;
    }
  }

  private move(dt: number): void {
    // No downward push while grounded: Rapier keeps its skin gap along the direction of
    // travel, so a shallow diagonal move would sink us into the floor. stayOnGround()
    // handles walking down slopes and steps instead.
    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    const start = { x: this.feet.x, y: this.feet.y, z: this.feet.z };

    // Plain slide move.
    const hits = this.slide(desired);

    // Source's StepMove: if something blocked us on the ground, also try lifting by the
    // step height, moving, and setting back down. Keep whichever went further. This
    // climbs stairs and ramps at full speed.
    const wantDist = Math.hypot(desired.x, desired.z);
    const slideDist = Math.hypot(this.feet.x - start.x, this.feet.z - start.z);
    if (this.grounded && this.settings.stepHeight > 0 && wantDist - slideDist > 1e-4) {
      const slideEnd = { x: this.feet.x, y: this.feet.y, z: this.feet.z };
      this.setFeet(start);
      const up = this.slide({ x: 0, y: this.settings.stepHeight, z: 0 });
      const lifted = this.feet.y - start.y;
      const over = this.slide({ x: desired.x, y: 0, z: desired.z });
      const down = this.castDown(lifted + SKIN * 2);
      const stepDist = Math.hypot(this.feet.x - start.x, this.feet.z - start.z);
      if (down && down.normal.y >= this.minWalkNormalY && stepDist > slideDist + 1e-4) {
        this.setFeet({ x: this.feet.x, y: this.feet.y - Math.max(down.toi - SKIN, 0), z: this.feet.z });
        hits.length = 0;
        hits.push(...up, ...over);
      } else {
        this.setFeet(slideEnd);
      }
    }

    // Clip velocity only against planes we're still pressed against after the move.
    // A stair riser we stepped over was hit on the way but is now below us.
    const planes: Vec3[] = [];
    for (const n of hits) {
      if (this.grounded && n.y >= this.minWalkNormalY) continue;
      if (this.velocity.x * n.x + this.velocity.y * n.y + this.velocity.z * n.z >= 0) continue;
      if (planes.some((p) => p.x * n.x + p.y * n.y + p.z * n.z > 0.999)) continue;
      if (this.touching(n)) planes.push(n);
    }
    clipVelocityToPlanes(this.velocity, planes);

    if (this.grounded) {
      // Distinguish a stair step from walking up a ramp for view smoothing.
      const mx = this.feet.x - start.x;
      const my = this.feet.y - start.y;
      const mz = this.feet.z - start.z;
      const n = this.groundNormal;
      const expected = n.y > 0 ? -(n.x * mx + n.z * mz) / n.y : 0;
      if (Math.abs(my - expected) > 0.05) this.events.stepDelta += my;
    }
  }

  /** Move with collide-and-slide from the current position. Returns the normals we hit. */
  private slide(delta: Vec3): Vec3[] {
    this.kcc.computeColliderMovement(this.collider, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const moved = this.kcc.computedMovement();
    this.setFeet({ x: this.feet.x + moved.x, y: this.feet.y + moved.y, z: this.feet.z + moved.z });
    const normals: Vec3[] = [];
    for (let i = 0; i < this.kcc.numComputedCollisions(); i++) {
      const c = this.kcc.computedCollision(i);
      if (!c) continue;
      const n = { x: c.normal1.x, y: c.normal1.y, z: c.normal1.z };
      normals.push(this.contactNormal && c.collider ? this.contactNormal(n, c.witness1, c.collider) : n);
    }
    return normals;
  }

  private setFeet(p: Vec3): void {
    this.feet.x = p.x;
    this.feet.y = p.y;
    this.feet.z = p.z;
    this.collider.setTranslation(this.center());
  }

  /** Is there something within touching distance against the plane normal `n`? */
  private touching(n: Vec3): boolean {
    const hit = this.world.castShape(
      this.center(),
      IDENTITY,
      { x: -n.x, y: -n.y, z: -n.z },
      this.hullShape(),
      0,
      SKIN * 2 + 0.005,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.collider,
    );
    return hit !== null;
  }

  /** Decide whether we're standing on something walkable (Source: CategorizePosition). */
  private categorizePosition(): void {
    if (this.velocity.y > NON_JUMP_VELOCITY) {
      this.grounded = false;
      return;
    }
    const hit = this.castDown(GROUND_PROBE + SKIN);
    if (hit && hit.normal.y >= this.minWalkNormalY) {
      this.grounded = true;
      this.groundNormal = hit.normal;
      this.seat(hit.toi);
    } else {
      this.grounded = false;
      this.groundNormal = { ...UP };
    }
  }

  /** Walking off a step or down a slope: pull us back down instead of briefly going airborne. */
  private stayOnGround(): void {
    if (this.velocity.y > 0) return;
    const hit = this.castDown(this.settings.stepHeight + SKIN);
    if (!hit || hit.normal.y < this.minWalkNormalY) return;
    const drop = Math.max(hit.toi - SKIN, 0);
    this.feet.y -= drop;
    this.collider.setTranslation(this.center());
    this.grounded = true;
    this.groundNormal = hit.normal;
    this.velocity.y = 0;
    this.events.stepDelta -= drop;
  }

  /** Rest exactly one skin-width above the ground, so the next move doesn't start in contact and stick. */
  private seat(gap: number): void {
    const adjust = SKIN - gap;
    if (Math.abs(adjust) < 1e-5) return;
    this.feet.y += adjust;
    this.collider.setTranslation(this.center());
  }

  private castDown(distance: number): { toi: number; normal: Vec3 } | null {
    const hit = this.world.castShape(
      this.center(),
      IDENTITY,
      { x: 0, y: -1, z: 0 },
      this.hullShape(),
      0,
      distance,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.collider,
    );
    if (!hit) return null;
    const n = hit.normal1;
    // A penetrating hit reports no useful normal; treat it as flat ground.
    const len = Math.hypot(n.x, n.y, n.z);
    const normal = len > 0.5 ? { x: n.x / len, y: n.y / len, z: n.z / len } : { ...UP };
    return { toi: hit.time_of_impact, normal };
  }

  private updateDuck(wantDuck: boolean, dt: number): void {
    const s = this.settings;
    const diff = s.standHeight - s.crouchHeight;

    this.groundDuckAge += dt;
    if (wantDuck && !this.ducked) {
      this.ducked = true;
      this.groundDuckAge = this.grounded ? 0 : Infinity;
      if (!this.grounded && this.fits(s.crouchHeight, this.feet.y + diff)) {
        // Pull the legs up: the head stays put, the feet rise. This is the crouch-jump.
        this.feet.y += diff;
        this.eyeHeight -= diff;
        this.prevEyeHeight -= diff;
        this.prevFeet.y += diff;
      }
      this.resizeHull();
    } else if (!wantDuck && this.ducked) {
      if (!this.grounded && this.fits(s.standHeight, this.feet.y - diff)) {
        this.ducked = false;
        this.feet.y -= diff;
        this.prevFeet.y -= diff;
        this.eyeHeight += diff;
        this.prevEyeHeight += diff;
        this.resizeHull();
      } else if (this.fits(s.standHeight, this.feet.y)) {
        this.ducked = false;
        this.resizeHull();
      }
    }

    // Ease the view towards the target eye height.
    const target = this.ducked ? s.crouchEyeHeight : s.standEyeHeight;
    const rate = (s.standEyeHeight - s.crouchEyeHeight) / Math.max(s.duckTime, 1e-3);
    const delta = target - this.eyeHeight;
    this.eyeHeight += Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);
  }

  /** Would a hull of this height fit with its feet at `feetY`? */
  private fits(height: number, feetY: number): boolean {
    const s = this.settings;
    const shape = new RAPIER.Cuboid(s.hullHalfWidth, height / 2, s.hullHalfWidth);
    const center = { x: this.feet.x, y: feetY + height / 2, z: this.feet.z };
    const blocker = this.world.intersectionWithShape(
      center,
      IDENTITY,
      shape,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      this.collider,
    );
    return blocker === null;
  }

  private resizeHull(): void {
    const s = this.settings;
    this.collider.setHalfExtents({ x: s.hullHalfWidth, y: this.hullHeight() / 2, z: s.hullHalfWidth });
    this.collider.setTranslation(this.center());
  }

  /**
   * Query shape matching the current hull. (Rapier's cached `collider.shape` doesn't
   * follow setHalfExtents, so we keep our own.)
   */
  private hullShape(): RAPIER.Cuboid {
    const s = this.settings;
    const h = this.hullHeight() / 2;
    const c = this.shapeCache;
    if (!c || c.halfExtents.x !== s.hullHalfWidth || c.halfExtents.y !== h) {
      this.shapeCache = new RAPIER.Cuboid(s.hullHalfWidth, h, s.hullHalfWidth);
    }
    return this.shapeCache!;
  }

  private center(): Vec3 {
    return { x: this.feet.x, y: this.feet.y + this.hullHeight() / 2, z: this.feet.z };
  }
}
