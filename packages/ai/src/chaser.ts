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
  /** Running to a fresh noise or where it last saw you (m/s). */
  investigateSpeed: number;
  /** Brisk walk while searching an area or following director hints (m/s). Slower than the player. */
  searchSpeed: number;
  /** Walking its patrol before it knows you're there (m/s). */
  patrolSpeed: number;
  /** Out of sight and further than this along the navmesh (m), it speeds up further. */
  catchUpDistance: number;
  catchUpMultiplier: number;
  /** How far it can see (m). */
  sightRange: number;
  /** Field of view close up (degrees). */
  fovDeg: number;
  /** Field of view at the edge of its sight range: it notices less off to the side far away. */
  fovFarDeg: number;
  /** Within this distance (m) it notices you whatever way it's facing. */
  nearSense: number;
  /** Seconds you must be in view (close up) before an unaware or searching chaser reacts. */
  reactionTime: number;
  /** The same at the edge of its sight range. */
  reactionTimeFar: number;
  /** Seconds out of sight before a chase becomes an investigation. */
  loseSightGrace: number;
  /** Seconds ahead it guesses you'll be from where it last saw you going. */
  predictTime: number;
  /** Noises through walls are heard at this fraction of their radius. */
  hearingThroughWalls: number;
  /** Seconds it looks around on reaching a place to search. */
  lookAroundTime: number;
  /** After losing you, seconds it searches near where it last knew you were before asking the director. */
  searchGrace: number;
  /** How far from that spot it looks during the grace period (m). */
  searchGraceRadius: number;
  /** No director hints until this many seconds after it (re)spawns. */
  hintDelay: number;
  /** Catch distance (m, horizontal). */
  catchRadius: number;
  /** Turning speed (rad/s). */
  turnRate: number;
}

export const defaultChaser: ChaserSettings = {
  chaseSpeed: 5.5,
  investigateSpeed: 6.3,
  searchSpeed: 4.5,
  patrolSpeed: 2.2,
  catchUpDistance: 30,
  catchUpMultiplier: 1.15,
  sightRange: 28,
  fovDeg: 120,
  fovFarDeg: 70,
  nearSense: 2,
  reactionTime: 0.35,
  reactionTimeFar: 0.8,
  loseSightGrace: 0.6,
  predictTime: 0.8,
  hearingThroughWalls: 0.35,
  lookAroundTime: 2.5,
  searchGrace: 12,
  searchGraceRadius: 8,
  hintDelay: 25,
  catchRadius: 0.9,
  turnRate: 8,
};

/** The chaser's view of the player. It only acts on this through sight, hearing, the director and the catch check. */
export interface Quarry {
  feet: Vec3;
  eye: Vec3;
  velocity: Vec3;
  colliderHandle: number;
  /** In a hiding place and keeping still: the director gives no hints. */
  hidden?: boolean;
}

export interface ChaserOptions {
  settings?: ChaserSettings;
  /** Body movement rules; its run speed is driven by the chaser. Defaults to the player's. */
  movement?: MovementSettings;
  director?: Director;
  /** Randomness for search decisions (inject a seeded one for tests). */
  random?: () => number;
  /** Starting state. Idle (patrolling, unaware) by default. */
  state?: ChaserState;
  /** Points it walks between while idle, in order, looping. */
  patrol?: Vec3[];
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
  /** Has it ever noticed you (this round)? The director only helps once it has. */
  alerted: boolean;
  patrol: Vec3[];
  readonly events = { caught: false, spotted: false };

  settings: ChaserSettings;
  readonly director: Director;
  private readonly random: () => number;
  private time = 0;
  private sinceSpawn = 0;
  private searchTime = 0;
  private patrolIndex = 0;
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
    this.state = options.state ?? "idle";
    this.alerted = this.state !== "idle";
    this.patrol = options.patrol ?? [];
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
  respawn(spawn: { position: Vec3; yaw: number }, state: ChaserState = "idle"): void {
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
    this.alerted = state !== "idle";
    this.sinceSpawn = 0;
    this.patrolIndex = 0;
  }

  update(dt: number, quarry: Quarry, noises: readonly NoiseEvent[]): void {
    const s = this.settings;
    this.time += dt;
    this.sinceSpawn += dt;
    this.events.caught = false;
    this.events.spotted = false;
    if (this.state === "caught") {
      this.move(dt, null, 0);
      return;
    }

    // Senses.
    const sees = this.canSee(quarry);
    this.sightTime = sees ? this.sightTime + dt : 0;
    // Slower to react to someone far away.
    const far = Math.min(dist(this.eye, quarry.eye) / s.sightRange, 1);
    const reaction = s.reactionTime + (s.reactionTimeFar - s.reactionTime) * far;
    let sensed = false;
    if (sees && (this.state === "chase" || this.sightTime >= reaction)) {
      sensed = true;
      this.lastSeenAt = this.time;
      this.lastKnown = { ...quarry.feet };
      this.lastSeenVelocity = { ...quarry.velocity };
      if (this.state !== "chase") {
        this.state = "chase";
        this.alerted = true;
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
          this.searchTime = 0;
        }
        break;
      case "search": {
        this.directiveTimer += dt;
        this.searchTime += dt;
        const lookedAround = this.arrived() && this.lookAround(dt);
        // First comb the area where it lost you; only then (and never before first
        // contact, or early in the round) does the director help.
        const local = this.searchTime < s.searchGrace || !this.alerted || this.sinceSpawn < s.hintDelay;
        if (local) {
          if (!this.directive || this.directive.kind !== "local" || lookedAround) {
            const around = this.lastKnown ?? this.body.feet;
            const spot = this.nav.randomPointNear(around, s.searchGraceRadius, this.random);
            if (spot) {
              this.directive = { position: spot, kind: "local" };
              this.goal = spot;
              this.lookTimer = 0;
            }
            this.directiveTimer = 0;
          }
          break;
        }
        const due = this.directiveTimer >= this.director.interval;
        if (!this.directive || this.directive.kind === "local" || (due && (this.directive.kind === "hint" || lookedAround))) {
          const next = this.director.next({
            nav: this.nav,
            quarry: quarry.feet,
            quarryHidden: quarry.hidden ?? false,
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
      case "idle": {
        // Patrol, unaware.
        const point = this.patrol[this.patrolIndex % Math.max(this.patrol.length, 1)];
        this.goal = point ?? null;
        if (point && this.arrived()) this.patrolIndex++;
        break;
      }
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
    const base = { chase: s.chaseSpeed, investigate: s.investigateSpeed, search: s.searchSpeed, idle: s.patrolSpeed }[
      this.state
    ];
    const speed = base * (this.catchingUp ? s.catchUpMultiplier : 1);

    this.move(dt, this.goal, speed);
    if (sees && this.state === "chase") this.turnTowards(yawTo(this.body.feet, quarry.feet), dt);
  }

  private startInvestigating(): void {
    this.state = "investigate";
    this.alerted = true;
    this.lookTimer = 0;
  }

  private canSee(q: Quarry): boolean {
    const s = this.settings;
    const eye = this.eye;
    const d = dist(eye, q.eye);
    if (d > s.sightRange) return false;
    if (d > s.nearSense) {
      // Narrower attention further away.
      const fov = s.fovDeg + (s.fovFarDeg - s.fovDeg) * Math.min(d / s.sightRange, 1);
      const off = Math.abs(wrapAngle(yawTo(eye, q.eye) - this.facing));
      if (off > ((fov / 2) * Math.PI) / 180) return false;
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
