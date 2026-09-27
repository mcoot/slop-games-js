import type { PhysicsWorld } from "@slop/physics";
import { PlayerController, tokyoMovement, type MovementSettings } from "@slop/fps-controller";
import { HintDirector, type Directive, type Director } from "./director";
import { dist, type Navigation, type Vec3 } from "./navigation";
import { lineOfSight, type NoiseEvent } from "./perception";

export type ChaserState = "idle" | "chase" | "investigate" | "search" | "caught";
/** What the player is told: does it know where I am? */
export type Awareness = "unaware" | "searching" | "hunting";

export interface ChaserSettings {
  /** Speed while it has you in sight (m/s). Keep it a little under the player's run speed. */
  chaseSpeed: number;
  /** Speed while investigating and searching (m/s). Above the player's run speed. */
  searchSpeed: number;
  /** Out of sight and further than this along the navmesh (m), it speeds up further. */
  catchUpDistance: number;
  catchUpMultiplier: number;
  /** How far it can see (m). */
  sightRange: number;
  /** Field of view (degrees). */
  fovDeg: number;
  /** Within this distance (m) it notices you whatever way it's facing. */
  nearSense: number;
  /** Seconds you must be in view before an unaware or searching chaser reacts. */
  reactionTime: number;
  /** Seconds out of sight before a chase becomes an investigation. */
  loseSightGrace: number;
  /** Seconds ahead it guesses you'll be from where it last saw you going. */
  predictTime: number;
  /** Noises through walls are heard at this fraction of their radius. */
  hearingThroughWalls: number;
  /** Seconds it looks around on reaching a place to search. */
  lookAroundTime: number;
  /** Catch distance (m, horizontal). */
  catchRadius: number;
  /** Turning speed (rad/s). */
  turnRate: number;
}

export const defaultChaser: ChaserSettings = {
  chaseSpeed: 5.7,
  searchSpeed: 6.3,
  catchUpDistance: 30,
  catchUpMultiplier: 1.15,
  sightRange: 45,
  fovDeg: 120,
  nearSense: 2,
  reactionTime: 0.35,
  loseSightGrace: 0.6,
  predictTime: 0.8,
  hearingThroughWalls: 0.35,
  lookAroundTime: 2.5,
  catchRadius: 0.9,
  turnRate: 8,
};

/** The chaser's view of the player. It only acts on this through sight, hearing, the director and the catch check. */
export interface Quarry {
  feet: Vec3;
  eye: Vec3;
  velocity: Vec3;
  colliderHandle: number;
}

export interface ChaserOptions {
  settings?: ChaserSettings;
  /** Body movement rules; its run speed is driven by the chaser. Defaults to the player's. */
  movement?: MovementSettings;
  director?: Director;
  /** Randomness for search decisions (inject a seeded one for tests). */
  random?: () => number;
  state?: ChaserState;
}

const ARRIVE = 0.7;
/** Eye height when it stoops to look under something (m). */
const STOOPED_EYE = 0.9;
const WAYPOINT_REACHED = 0.45;

/**
 * A relentless pursuer that doesn't cheat: it sees (range, field of view, line of
 * sight), hears noises, and when it has lost you a Director feeds it fuzzy places to
 * look. It walks with the same Source-style controller as the player, so it climbs
 * the same stairs and slopes but can't jump or crouch: gaps and crawlspaces lose it.
 *
 * Call `update` every tick, before `world.step()`.
 */
export class Chaser {
  readonly body: PlayerController;
  state: ChaserState;
  /** Where it's looking (yaw, same convention as the player). */
  facing: number;
  /** Where it's currently heading, if anywhere. */
  goal: Vec3 | null = null;
  /** Where it thinks you are. */
  lastKnown: Vec3 | null = null;
  /** Its current search directive, while searching. */
  directive: Directive | null = null;
  catchingUp = false;
  /** Seconds since it last saw or heard you. */
  timeLost = 0;
  readonly events = { caught: false, spotted: false };

  settings: ChaserSettings;
  readonly director: Director;
  private readonly random: () => number;
  private time = 0;
  private sightTime = 0;
  private lastSeenAt = -Infinity;
  private lastSeenVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  private path: Vec3[] = [];
  private waypoint = 0;
  private pathGoal: Vec3 | null = null;
  private repathTimer = 0;
  private lookTimer = 0;
  private lookBase = 0;
  private directiveTimer = Infinity;
  private catchUpTimer = 0;
  private stuckTimer = 0;
  private stuckFrom: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly world: PhysicsWorld,
    private nav: Navigation,
    spawn: { position: Vec3; yaw: number },
    options: ChaserOptions = {},
  ) {
    this.settings = options.settings ?? { ...defaultChaser };
    this.director = options.director ?? new HintDirector();
    this.random = options.random ?? Math.random;
    this.state = options.state ?? "search";
    this.body = new PlayerController(world, { ...(options.movement ?? tokyoMovement) }, spawn.position);
    this.facing = spawn.yaw;
  }

  get awareness(): Awareness {
    if (this.state === "chase" || this.state === "caught") return "hunting";
    return this.state === "idle" ? "unaware" : "searching";
  }

  get eye(): Vec3 {
    return { x: this.body.feet.x, y: this.body.feet.y + this.body.eyeHeight, z: this.body.feet.z };
  }

  /** Swap the navmesh (level hot reload). */
  setNavigation(nav: Navigation): void {
    this.nav = nav;
    this.path = [];
    this.pathGoal = null;
  }

  /** Put it back at a spawn for a new round. */
  respawn(spawn: { position: Vec3; yaw: number }, state: ChaserState = "search"): void {
    this.body.teleport(spawn.position);
    this.facing = spawn.yaw;
    this.state = state;
    this.goal = this.lastKnown = this.directive = null;
    this.path = [];
    this.pathGoal = null;
    this.timeLost = 0;
    this.sightTime = 0;
    this.lastSeenAt = -Infinity;
    this.directiveTimer = Infinity;
    this.director.reset();
  }

  update(dt: number, quarry: Quarry, noises: readonly NoiseEvent[]): void {
    const s = this.settings;
    this.time += dt;
    this.events.caught = false;
    this.events.spotted = false;
    if (this.state === "caught") {
      this.move(dt, null, 0);
      return;
    }

    // Senses.
    const sees = this.canSee(quarry);
    this.sightTime = sees ? this.sightTime + dt : 0;
    let sensed = false;
    if (sees && (this.state === "chase" || this.sightTime >= s.reactionTime)) {
      sensed = true;
      this.lastSeenAt = this.time;
      this.lastKnown = { ...quarry.feet };
      this.lastSeenVelocity = { ...quarry.velocity };
      if (this.state !== "chase") {
        this.state = "chase";
        this.events.spotted = true;
      }
    }
    if (this.state !== "chase") {
      for (const noise of noises) {
        if (!this.hears(noise, quarry)) continue;
        sensed = true;
        this.lastKnown = { ...noise.position };
        this.startInvestigating();
      }
    }
    if (sensed) {
      this.timeLost = 0;
      this.director.reset();
    } else {
      this.timeLost += dt;
    }

    // Decide where to go.
    switch (this.state) {
      case "chase":
        if (!sees && this.time - this.lastSeenAt > s.loseSightGrace) {
          // Head for where you were going, not where you are.
          const k = s.predictTime;
          const v = this.lastSeenVelocity;
          const guess = { x: this.lastKnown!.x + v.x * k, y: this.lastKnown!.y, z: this.lastKnown!.z + v.z * k };
          this.lastKnown = this.nav.closestPoint(guess) ?? this.lastKnown;
          this.startInvestigating();
        } else {
          this.goal = sees ? { ...quarry.feet } : this.lastKnown;
        }
        break;
      case "investigate":
        this.goal = this.lastKnown;
        if (this.arrived() && this.lookAround(dt)) {
          this.state = "search";
          this.directive = null;
          this.directiveTimer = Infinity;
        }
        break;
      case "search": {
        this.directiveTimer += dt;
        const lookedAround = this.arrived() && this.lookAround(dt);
        const due = this.directiveTimer >= this.director.interval;
        if (!this.directive || (due && (this.directive.kind === "hint" || lookedAround))) {
          const next = this.director.next({
            nav: this.nav,
            quarry: quarry.feet,
            hunter: this.body.feet,
            timeLost: this.timeLost,
            random: this.random,
          });
          if (next) {
            this.directive = next;
            this.goal = next.position;
            this.lookTimer = 0;
          }
          this.directiveTimer = 0;
        }
        break;
      }
      case "idle":
        this.goal = null;
        break;
    }

    // Catch.
    const dx = quarry.feet.x - this.body.feet.x;
    const dz = quarry.feet.z - this.body.feet.z;
    if (
      Math.hypot(dx, dz) < s.catchRadius &&
      Math.abs(quarry.feet.y - this.body.feet.y) < 1.2 &&
      lineOfSight(this.world, this.eye, quarry.eye, [this.body.colliderHandle, quarry.colliderHandle])
    ) {
      this.state = "caught";
      this.events.caught = true;
      this.move(dt, null, 0);
      return;
    }

    // Speed: slower than you in sight, faster out of it, faster still when far behind.
    this.catchUpTimer -= dt;
    if (this.catchUpTimer <= 0) {
      this.catchUpTimer = 0.5;
      this.catchingUp =
        !sees &&
        this.state !== "idle" &&
        this.nav.pathLength(this.body.feet, quarry.feet) > s.catchUpDistance;
    }
    if (sees) this.catchingUp = false;
    const speed =
      (this.state === "chase" ? s.chaseSpeed : s.searchSpeed) * (this.catchingUp ? s.catchUpMultiplier : 1);

    this.move(dt, this.goal, speed);
    if (sees && this.state === "chase") this.turnTowards(yawTo(this.body.feet, quarry.feet), dt);
  }

  private startInvestigating(): void {
    this.state = "investigate";
    this.lookTimer = 0;
  }

  private canSee(q: Quarry): boolean {
    const s = this.settings;
    const eye = this.eye;
    const d = dist(eye, q.eye);
    if (d > s.sightRange) return false;
    if (d > s.nearSense) {
      const off = Math.abs(wrapAngle(yawTo(eye, q.eye) - this.facing));
      if (off > ((s.fovDeg / 2) * Math.PI) / 180) return false;
    }
    // Look at the head and the chest, standing and stooped (to see under low ceilings it can't enter).
    const ignore = [this.body.colliderHandle, q.colliderHandle];
    const chest = { x: q.feet.x, y: q.feet.y + 1.0, z: q.feet.z };
    const stooped = { x: eye.x, y: this.body.feet.y + STOOPED_EYE, z: eye.z };
    return [eye, stooped].some((from) => [q.eye, chest].some((to) => lineOfSight(this.world, from, to, ignore)));
  }

  private hears(noise: NoiseEvent, q: Quarry): boolean {
    const eye = this.eye;
    const d = dist(noise.position, eye);
    if (d > noise.radius) return false;
    const from = { x: noise.position.x, y: noise.position.y + 0.3, z: noise.position.z };
    if (lineOfSight(this.world, from, eye, [this.body.colliderHandle, q.colliderHandle])) return true;
    return d <= noise.radius * this.settings.hearingThroughWalls;
  }

  private arrived(): boolean {
    if (!this.goal) return true;
    const end = this.path.at(-1);
    const f = this.body.feet;
    // At the goal, or at the end of the path when the goal can't be reached.
    return hdist(f, this.goal) < ARRIVE || (end !== undefined && this.waypoint >= this.path.length && hdist(f, end) < ARRIVE);
  }

  /** Sweep the view left and right. True once it has looked for long enough. */
  private lookAround(dt: number): boolean {
    if (this.lookTimer === 0) this.lookBase = this.facing;
    this.lookTimer += dt;
    this.facing = this.lookBase + Math.sin(this.lookTimer * 2.2) * 1.2;
    return this.lookTimer >= this.settings.lookAroundTime;
  }

  private move(dt: number, goal: Vec3 | null, speed: number): void {
    const body = this.body;
    let forward = 0;
    let moveYaw = this.facing;

    if (goal && speed > 0) {
      this.repathTimer -= dt;
      const goalMoved = !this.pathGoal || hdist(goal, this.pathGoal) > 0.5 || Math.abs(goal.y - this.pathGoal.y) > 0.5;
      if (goalMoved || this.repathTimer <= 0) this.repath(goal);

      // Unstick: if we've barely moved in a second while trying to, plan again.
      this.stuckTimer += dt;
      if (this.stuckTimer >= 1) {
        if (hdist(body.feet, this.stuckFrom) < 0.3 && this.waypoint < this.path.length) this.repath(goal);
        this.stuckTimer = 0;
        this.stuckFrom = { x: body.feet.x, y: body.feet.y, z: body.feet.z };
      }

      while (this.waypoint < this.path.length && hdist(body.feet, this.path[this.waypoint]!) < WAYPOINT_REACHED) {
        this.waypoint++;
      }
      const next = this.path[this.waypoint];
      if (next && !(this.waypoint === this.path.length - 1 && hdist(body.feet, next) < ARRIVE * 0.5)) {
        forward = 1;
        moveYaw = yawTo(body.feet, next);
        this.turnTowards(moveYaw, dt);
      }
    }

    body.settings.runSpeed = Math.max(speed, 0.01);
    body.tick({ forward, side: 0, jumpPresses: 0, jumpHeld: false, crouch: false, walk: false, yaw: moveYaw }, dt);
  }

  private repath(goal: Vec3): void {
    this.path = this.nav.path(this.body.feet, goal);
    this.waypoint = 1;
    this.pathGoal = { ...goal };
    this.repathTimer = this.state === "chase" ? 0.2 : 1;
  }

  private turnTowards(yaw: number, dt: number): void {
    const diff = wrapAngle(yaw - this.facing);
    const step = this.settings.turnRate * dt;
    this.facing = wrapAngle(this.facing + Math.max(-step, Math.min(step, diff)));
  }
}

/** Yaw that looks from `a` towards `b` (0 looks down -Z, positive turns left). */
export function yawTo(a: Vec3, b: Vec3): number {
  return Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function hdist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
