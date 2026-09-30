import { isNetMessage, type NetMessage } from "../src/net/protocol";
import { SERVER_ID, type ServerFrame } from "../src/net/wire";
import { Referee, defaultRefereeSettings } from "../src/combat/referee";
import { mapById } from "../src/maps";
import { bondiSkiMovement } from "../src/movement";
import type { TeamId } from "../src/combat/teams";
import type { ArenaWorld } from "./worlds";

type Hello = Extract<NetMessage, { t: "hello" }>;

interface Member {
  id: string;
  send(frame: ServerFrame): void;
  hello: Hello | null;
  /** One-way latency (s), from the server's pings. */
  latency: number;
  pings: number;
}

/**
 * One room on the server. Everyone's messages are passed on to everyone else, except
 * claims of damage, deaths and matches, which only the server makes. In a deathmatch
 * room a `Referee` judges the fight, on the map and game of the room's host (whoever has
 * been in longest, as players work out themselves).
 */
export class Room {
  readonly members = new Map<string, Member>();
  referee: Referee | null = null;
  /** The map and game the referee is running. */
  private running = "";

  constructor(
    readonly name: string,
    private readonly worlds: Map<string, ArenaWorld>,
    private readonly clock: () => number = () => performance.now(),
  ) {}

  get empty(): boolean {
    return this.members.size === 0;
  }

  add(id: string, send: (frame: ServerFrame) => void): void {
    // Reconnecting with the same id: the old connection is gone.
    if (this.members.has(id)) this.remove(id);
    const others = [...this.members.values()];
    // In first, so anything they send in answer to the list below counts.
    this.members.set(id, { id, send, hello: null, latency: 0.05, pings: 0 });
    for (const m of others) m.send({ k: "join", id });
    send({ k: "peers", ids: others.map((m) => m.id) });
    if (this.referee) {
      this.referee.join(id);
      const r = this.referee;
      send({ k: "msg", from: SERVER_ID, m: { t: "match", id: r.match.id, target: r.match.target, ...r.board() } });
    }
  }

  remove(id: string): void {
    if (!this.members.delete(id)) return;
    this.referee?.leave(id);
    for (const m of this.members.values()) m.send({ k: "leave", id });
    this.chooseGame();
  }

  receive(from: string, m: unknown, to?: string): void {
    const member = this.members.get(from);
    if (!member || !isNetMessage(m)) return;
    if (to === SERVER_ID) {
      if (m.t === "pong" && typeof m.at === "number") {
        const oneWay = Math.min(Math.max((this.clock() - m.at) / 2000, 0), 0.25);
        member.latency = member.pings === 0 ? oneWay : member.latency * 0.8 + oneWay * 0.2;
        member.pings++;
        const c = this.referee?.contenders.get(from);
        if (c) c.latency = member.latency;
      }
      return;
    }
    const r = this.referee;
    switch (m.t) {
      case "hello":
        member.hello = m;
        this.chooseGame();
        if (this.referee) this.referee.join(from).team = teamOf(m.team);
        break;
      case "state":
        if (!finite(m.x, m.y, m.z, m.vx, m.vy, m.vz)) return;
        if (m.team !== undefined && r) {
          const c = r.contenders.get(from);
          if (c) c.team = teamOf(m.team);
        }
        r?.state(from, { x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, air: m.air === true });
        break;
      case "fire":
        if (!finite(m.x, m.y, m.z, m.vx, m.vy, m.vz)) return;
        r?.fire(from, m.w, { x: m.x, y: m.y, z: m.z }, { x: m.vx, y: m.vy, z: m.vz });
        break;
      // Only the server says who's hurt or dead, and when matches start.
      case "hurt":
      case "died":
      case "match":
      case "hit":
      case "spawn":
        return;
    }
    const frame: ServerFrame = { k: "msg", from, m };
    if (to) this.members.get(to)?.send(frame);
    else for (const o of this.members.values()) if (o.id !== from) o.send(frame);
  }

  /** Ask everyone for a pong, to measure their latency. */
  ping(): void {
    const at = this.clock();
    for (const m of this.members.values()) m.send({ k: "msg", from: SERVER_ID, m: { t: "ping", at } });
  }

  step(dt: number): void {
    this.referee?.step(dt);
  }

  /** The host's map and game: start (or restart) the referee when they change. */
  private chooseGame(): void {
    let host: Member | null = null;
    for (const m of this.members.values()) {
      const since = m.hello?.since;
      if (typeof since !== "number") continue;
      const best = host?.hello?.since ?? Infinity;
      if (since < best || (since === best && m.id < host!.id)) host = m;
    }
    const hello = host?.hello;
    const key = hello ? `${mapById(hello.map).id}/${hello.game === "teams" ? "teams" : "ffa"}` : "";
    if (key === this.running) return;
    this.running = key;
    this.referee = null;
    if (!hello) return;
    const arena = this.worlds.get(mapById(hello.map).id);
    if (!arena) return;
    this.referee = new Referee(
      arena.world,
      arena.course.terrain,
      arena.layout,
      { ...defaultRefereeSettings, game: hello.game === "teams" ? "teams" : "ffa", gravity: bondiSkiMovement.gravity, standHeight: bondiSkiMovement.standHeight },
      {
        hurt: (victim, by, w, hit, health) => {
          const hp = Math.round(health);
          const dmg = Math.round(hit.damage);
          const i = hit.impulse;
          this.members.get(victim)?.send({ k: "msg", from: SERVER_ID, m: { t: "hit", by, w: w.id, dmg, hp, midair: hit.midair, ix: r2(i.x), iy: r2(i.y), iz: r2(i.z) } });
          if (dmg > 0) this.broadcast(victim, { t: "hurt", by, w: w.id, dmg, hp, midair: hit.midair }, victim);
        },
        died: (victim, by, w) => this.broadcast(victim, { t: "died", by, w: w.id }),
        spawn: (id, at) => this.members.get(id)?.send({ k: "msg", from: SERVER_ID, m: { t: "spawn", x: r2(at.x), y: r2(at.y), z: r2(at.z) } }),
        match: (id, target) => this.broadcast(SERVER_ID, { t: "match", id, target }),
      },
    );
    // Everyone starts the new match from a spawn point.
    for (const m of this.members.values()) {
      const c = this.referee.join(m.id, teamOf(m.hello?.team));
      c.latency = m.latency;
      this.referee.respawn(c);
    }
  }

  /** A message to everyone (but `except`), as if from `from`. */
  private broadcast(from: string, m: NetMessage, except?: string): void {
    for (const o of this.members.values()) if (o.id !== except) o.send({ k: "msg", from, m });
  }
}

function teamOf(t: unknown): TeamId | null {
  return t === 0 || t === 1 ? t : null;
}

function finite(...v: unknown[]): boolean {
  return v.every((x) => typeof x === "number" && Number.isFinite(x));
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
