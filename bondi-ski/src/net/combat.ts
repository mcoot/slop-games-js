import type { NetMessage } from "./protocol";
import { colourFor, INTERPOLATION_DELAY_MS, SEND_INTERVAL_MS, type Snapshot } from "./session";
import type { Transport } from "./transport";
import type { TeamId } from "../combat/teams";

/**
 * A room of fighters. Carries positions (for drawing and for projectiles to hit), shots,
 * and each player's own report of the damage they took and their deaths: every client
 * simulates every projectile, and each player is the judge of what hit *them*, so what
 * you dodged on your screen really missed. Scores are counted by everyone from the
 * death reports.
 */
export interface RemoteFighter {
  id: string;
  name: string;
  colour: string;
  snapshots: (Snapshot & { pitch: number })[];
  velocity: { x: number; y: number; z: number };
  alive: boolean;
  hp: number;
  weapon: string;
  airborne: boolean;
  /** Estimated one-way latency (s), to fast-forward their shots. */
  latency: number;
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
  match(id: string, target: number): void;
}

const UNNAMED = "…";

export class CombatSession {
  readonly peers = new Map<string, RemoteFighter>();
  private seq = 0;
  private lastSent = -Infinity;

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
        velocity: { x: 0, y: 0, z: 0 },
        alive: true,
        hp: 0,
        weapon: "disc",
        airborne: false,
        latency: 0.05,
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
    if (now - this.lastSent < SEND_INTERVAL_MS) return;
    this.lastSent = now;
    this.transport.send({ t: "state", seq: this.seq++, ...me, ...(this.team !== null ? { team: this.team } : {}), x: r2(me.x), y: r2(me.y), z: r2(me.z), yaw: r2(me.yaw), pitch: r2(me.pitch), vx: r2(me.vx), vy: r2(me.vy), vz: r2(me.vz) });
  }

  fire(m: Omit<Extract<NetMessage, { t: "fire" }>, "t">): void {
    this.transport.send({ t: "fire", ...m });
  }

  hurt(by: string, w: string, dmg: number, hp: number, midair: boolean): void {
    this.transport.send({ t: "hurt", by, w, dmg, hp, midair });
  }

  died(by: string, w: string): void {
    this.transport.send({ t: "died", by, w });
  }

  startMatch(id: string, target: number): void {
    this.transport.send({ t: "match", id, target });
  }

  leave(): void {
    this.transport.leave();
  }

  /** Where to draw someone: interpolated a little in the past. */
  sample(f: RemoteFighter): (Snapshot & { pitch: number }) | null {
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
        return { at: t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: a.yaw + dy * k, pitch: a.pitch + (b.pitch - a.pitch) * k };
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
        if (peer) peer.latency = Math.min((this.now() - m.at) / 2000, 0.25);
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
        peer.snapshots.push({ at: this.now(), x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch });
        if (peer.snapshots.length > 20) peer.snapshots.shift();
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
        this.events.match(m.id, m.target);
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
