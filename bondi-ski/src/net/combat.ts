import type { NetMessage } from "./protocol";
import { extrapolate } from "./predict";
import { SERVER_ID } from "./wire";
import { colourFor, INTERPOLATION_DELAY_MS, SEND_INTERVAL_MS, type Snapshot } from "./session";
import type { Transport } from "./transport";
import type { TeamId } from "../combat/teams";

/** A fighter's pose: where their feet are and where they look. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

type FighterSnapshot = Snapshot & { pitch: number; vx: number; vy: number; vz: number; air: boolean };

/**
 * How remote fighters are placed. With `predict` on, they're shown where they should be
 * *now* (their last state carried forward by its velocity, plus gravity in the air) so
 * what you aim at is where they really are; off, they're shown a little in the past,
 * smoothly interpolated, which is accurate but lags behind a fast skier by metres.
 */
export const netSettings = {
  predict: true,
  /** Furthest ahead of their last state we'll guess (s). */
  maxAhead: 0.35,
  /** How quickly a correction (a new state that disagrees with the guess) fades out (s). */
  smoothing: 0.08,
  /** A correction bigger than this (m) is a teleport (respawn): snap, don't slide. */
  snapDistance: 6,
  /** How often to re-measure latency (s). */
  pingInterval: 1,
  /** Gravity for airborne fighters (m/s², the movement settings' gravity). */
  gravity: 16,
};

export interface RemoteFighter {
  id: string;
  name: string;
  colour: string;
  snapshots: FighterSnapshot[];
  /** What's left of the last correction, fading from `correctionAt`. */
  correction: { x: number; y: number; z: number };
  correctionAt: number;
  velocity: { x: number; y: number; z: number };
  alive: boolean;
  hp: number;
  weapon: string;
  airborne: boolean;
  /** Estimated one-way latency (s), to fast-forward their shots and their position. */
  latency: number;
  /** Latency measurements so far (the first replaces the guess, later ones are smoothed in). */
  pings: number;
  /** Their team when playing teams (null until they say). */
  team: TeamId | null;
  /** What they said in their hello: when they joined, and their map and game (null until then). */
  room: RoomInfo | null;
}

/** When you joined the room (ms since the epoch: the earliest is the host), and your map and game. */
export interface RoomInfo {
  since: number;
  map: string;
  game: string;
}

export interface CombatEvents {
  peersChanged(): void;
  fire(from: string, m: Extract<NetMessage, { t: "fire" }>, age: number): void;
  hurt(victim: string, m: Extract<NetMessage, { t: "hurt" }>): void;
  died(victim: string, by: string, weapon: string): void;
  match(id: string, target: number, board?: Extract<NetMessage, { t: "match" }>): void;
  /** From a game server: we were hurt. */
  hit?(m: Extract<NetMessage, { t: "hit" }>): void;
  /** From a game server: we're back in, here. */
  spawn?(at: { x: number; y: number; z: number }): void;
}

const UNNAMED = "…";

/**
 * A room of fighters on the game server. Carries positions (for drawing and for
 * projectiles to hit) and shots between players; the server judges the fight and sends
 * the damage, deaths, respawns and matches. Every client still simulates every
 * projectile, for drawing.
 */
export class CombatSession {
  readonly peers = new Map<string, RemoteFighter>();
  private seq = 0;
  private lastSent = -Infinity;
  private lastPing = -Infinity;
  /** The ground under a point, so an airborne guess doesn't sink into it (optional). */
  ground: ((x: number, z: number) => number) | null = null;

  /** Our team when playing teams. */
  team: TeamId | null = null;

  constructor(
    readonly transport: Transport,
    public name: string,
    private readonly events: CombatEvents,
    private readonly now: () => number = () => performance.now(),
    readonly room: RoomInfo = { since: 0, map: "", game: "" },
  ) {
    transport.onMessage((from, m) => this.receive(from, m));
    const join = (id: string) => {
      this.peers.set(id, {
        id,
        name: UNNAMED,
        colour: colourFor(id),
        snapshots: [],
        correction: { x: 0, y: 0, z: 0 },
        correctionAt: 0,
        velocity: { x: 0, y: 0, z: 0 },
        alive: true,
        hp: 0,
        weapon: "disc",
        airborne: false,
        latency: 0.05,
        pings: 0,
        team: null,
        room: null,
      });
      this.hello(id);
      transport.send({ t: "ping", at: this.now() }, id);
      events.peersChanged();
    };
    transport.onPeerJoin(join);
    for (const id of transport.peerIds()) join(id);
    transport.onPeerLeave((id) => {
      this.peers.delete(id);
      events.peersChanged();
    });
  }

  get selfId(): string {
    return this.transport.selfId;
  }

  get colour(): string {
    return colourFor(this.selfId);
  }

  /**
   * The room's host: whoever has been in it longest (of those we've heard from). Their
   * map and game are the room's; if they leave, the next longest takes over.
   */
  get hostId(): string {
    let best = { id: this.selfId, since: this.room.since };
    for (const p of this.peers.values()) {
      if (!p.room) continue;
      if (p.room.since < best.since || (p.room.since === best.since && p.id < best.id)) best = { id: p.id, since: p.room.since };
    }
    return best.id;
  }

  get isHost(): boolean {
    return this.hostId === this.selfId;
  }

  setName(name: string): void {
    this.name = name;
    this.hello();
  }

  setTeam(team: TeamId | null): void {
    this.team = team;
    this.hello();
  }

  tick(me: Omit<Extract<NetMessage, { t: "state" }>, "t" | "seq">): void {
    const now = this.now();
    if (now - this.lastPing >= netSettings.pingInterval * 1000) {
      this.lastPing = now;
      if (this.peers.size > 0) this.transport.send({ t: "ping", at: now });
    }
    if (now - this.lastSent < SEND_INTERVAL_MS) return;
    this.lastSent = now;
    this.transport.send({ t: "state", seq: this.seq++, ...me, ...(this.team !== null ? { team: this.team } : {}), x: r2(me.x), y: r2(me.y), z: r2(me.z), yaw: r2(me.yaw), pitch: r2(me.pitch), vx: r2(me.vx), vy: r2(me.vy), vz: r2(me.vz) });
  }

  fire(m: Omit<Extract<NetMessage, { t: "fire" }>, "t">): void {
    this.transport.send({ t: "fire", ...m });
  }

  leave(): void {
    this.transport.leave();
  }

  /**
   * Where someone is, for drawing them and for your shots to hit: predicted to now, or
   * interpolated in the past with prediction off.
   */
  pose(f: RemoteFighter): Pose | null {
    if (!netSettings.predict) return this.sample(f);
    const p = this.predict(f);
    if (!p) return null;
    const k = Math.exp(-(this.now() - f.correctionAt) / 1000 / Math.max(netSettings.smoothing, 1e-3));
    return { ...p, x: p.x + f.correction.x * k, y: p.y + f.correction.y * k, z: p.z + f.correction.z * k };
  }

  /** Their last state carried forward to now: sent `latency` before it arrived, and it's aged since. */
  private predict(f: RemoteFighter): Pose | null {
    const last = f.snapshots.at(-1);
    if (!last) return null;
    const ahead = Math.min(Math.max((this.now() - last.at) / 1000 + f.latency, 0), netSettings.maxAhead);
    const { x, y, z } = extrapolate(last, ahead, netSettings.gravity, this.ground);
    return { x, y, z, yaw: last.yaw, pitch: last.pitch };
  }

  /** Where to draw someone: interpolated a little in the past. */
  sample(f: RemoteFighter): Pose | null {
    const s = f.snapshots;
    if (s.length === 0) return null;
    const t = this.now() - INTERPOLATION_DELAY_MS;
    if (t <= s[0]!.at) return s[0]!;
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1]!;
      const b = s[i]!;
      if (t >= a.at) {
        const k = Math.min((t - a.at) / Math.max(b.at - a.at, 1), 1);
        let dy = b.yaw - a.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: a.yaw + dy * k, pitch: a.pitch + (b.pitch - a.pitch) * k };
      }
    }
    return s.at(-1)!;
  }

  private hello(to?: string): void {
    this.transport.send({ t: "hello", name: this.name, colour: this.colour, ...this.room, ...(this.team !== null ? { team: this.team } : {}) }, to);
  }

  private receive(from: string, m: NetMessage): void {
    const peer = this.peers.get(from);
    switch (m.t) {
      case "ping":
        this.transport.send({ t: "pong", at: m.at }, from);
        return;
      case "pong":
        if (peer) {
          const oneWay = Math.min((this.now() - m.at) / 2000, 0.25);
          peer.latency = peer.pings === 0 ? oneWay : peer.latency * 0.8 + oneWay * 0.2;
          peer.pings++;
        }
        return;
      case "hello":
        if (peer) {
          const first = peer.name === UNNAMED;
          peer.name = m.name.slice(0, 24) || "Skier";
          peer.team = teamOf(m.team);
          if (typeof m.since === "number") peer.room = { since: m.since, map: String(m.map ?? ""), game: String(m.game ?? "") };
          if (first) this.hello(from);
          this.events.peersChanged();
        }
        return;
      case "state":
        if (!peer) return;
        {
          // Where we were showing them, so the jump to the new guess can be smoothed out.
          const before = this.pose(peer);
          peer.snapshots.push({ at: this.now(), x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, vx: m.vx, vy: m.vy, vz: m.vz, air: m.air });
          if (peer.snapshots.length > 20) peer.snapshots.shift();
          const after = this.predict(peer)!;
          const c = before ? { x: before.x - after.x, y: before.y - after.y, z: before.z - after.z } : { x: 0, y: 0, z: 0 };
          const respawned = !peer.alive && m.alive;
          peer.correction = respawned || Math.hypot(c.x, c.y, c.z) > netSettings.snapDistance ? { x: 0, y: 0, z: 0 } : c;
          peer.correctionAt = this.now();
        }
        peer.velocity = { x: m.vx, y: m.vy, z: m.vz };
        peer.alive = m.alive;
        peer.hp = m.hp;
        peer.weapon = m.w;
        peer.airborne = m.air;
        if (m.team !== undefined && teamOf(m.team) !== peer.team) {
          peer.team = teamOf(m.team);
          this.events.peersChanged();
        }
        return;
      case "fire":
        if (peer) this.events.fire(from, m, peer.latency);
        return;
      case "hurt":
        if (peer) peer.hp = m.hp;
        this.events.hurt(from, m);
        return;
      case "died":
        if (peer) peer.alive = false;
        this.events.died(from, m.by, m.w);
        return;
      case "match":
        this.events.match(m.id, m.target, m);
        return;
      // Only a game server judges damage and respawns.
      case "hit":
        if (from === SERVER_ID) this.events.hit?.(m);
        return;
      case "spawn":
        if (from === SERVER_ID) this.events.spawn?.({ x: m.x, y: m.y, z: m.z });
        return;
      default:
        return;
    }
  }
}

function teamOf(t: unknown): TeamId | null {
  return t === 0 || t === 1 ? t : null;
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
