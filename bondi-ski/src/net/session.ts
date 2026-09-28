import type { NetMessage } from "./protocol";
import { randomId, type Transport } from "./transport";

/**
 * A room of racers. Handles who's here, starting a race together (a shared countdown),
 * everyone's positions for drawing, and live standings. Time comes in from outside
 * (`tick(nowMs)`) so tests can drive it.
 *
 * Races are mass starts: when anyone starts one, every racer in the room freezes at the
 * start, counts down together, and the clock starts for all on "go".
 */
export type Phase = "free" | "countdown" | "racing" | "done";

export interface Snapshot {
  at: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface Peer {
  id: string;
  name: string;
  colour: string;
  /** Recent positions, oldest first, stamped with when we received them. */
  snapshots: Snapshot[];
  race: string;
  /** Their race clock at the last position, next gate, and finish time if they've finished. */
  time: number;
  next: number;
  finish: number | null;
}

export interface Standing {
  id: string;
  name: string;
  colour: string;
  self: boolean;
  /** Finish time, or null while still racing. */
  finish: number | null;
  /** Gates passed. */
  gates: number;
  /** Distance along the course (m), for ordering racers between gates. */
  progress: number;
}

export interface SessionEvents {
  /** A race is starting: freeze at the start. `slot` spreads racers out on the line. */
  countdown(slot: number): void;
  go(): void;
  peersChanged(): void;
}

export const SEND_INTERVAL_MS = 50;
export const INTERPOLATION_DELAY_MS = 120;
const COUNTDOWN_SECONDS = 4;
const COLOURS = ["#ff6b5e", "#ffcf3d", "#3ddc84", "#b18cff", "#ff8fd8", "#6fd3ff", "#ffa94d", "#e6f36b"];

export class RaceSession {
  readonly peers = new Map<string, Peer>();
  phase: Phase = "free";
  race = "";
  /** Local time the current countdown ends. */
  goAt = 0;
  /** My finish time in this race. */
  finish: number | null = null;
  private seq = 0;
  private lastSent = -Infinity;
  private rtt = new Map<string, number>();

  constructor(
    readonly transport: Transport,
    public name: string,
    private readonly events: SessionEvents,
    private readonly progressOf: (x: number, z: number) => number,
    private readonly now: () => number = () => performance.now(),
  ) {
    const join = (id: string) => {
      this.peers.set(id, { id, name: "…", colour: colourFor(id), snapshots: [], race: "", time: 0, next: 0, finish: null });
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
    transport.onMessage((from, m) => this.receive(from, m));
  }

  get selfId(): string {
    return this.transport.selfId;
  }

  get colour(): string {
    return colourFor(this.selfId);
  }

  setName(name: string): void {
    this.name = name;
    this.hello();
  }

  /** Start a race for everyone in the room. */
  startRace(): void {
    const race = randomId(6);
    this.transport.send({ t: "countdown", race, seconds: COUNTDOWN_SECONDS });
    this.beginCountdown(race, COUNTDOWN_SECONDS * 1000);
  }

  /** Seconds left in the countdown (0 once racing). */
  get countdownLeft(): number {
    return this.phase === "countdown" ? Math.max(0, (this.goAt - this.now()) / 1000) : 0;
  }

  /** Call every tick with my state; sends positions at the send rate and handles "go". */
  tick(me: { x: number; y: number; z: number; yaw: number; time: number; next: number }): void {
    const now = this.now();
    if (this.phase === "countdown" && now >= this.goAt) {
      this.phase = "racing";
      this.events.go();
    }
    if (now - this.lastSent >= SEND_INTERVAL_MS) {
      this.lastSent = now;
      this.transport.send({ t: "pos", seq: this.seq++, race: this.racing ? this.race : "", ...round(me) });
    }
  }

  private get racing(): boolean {
    return this.phase === "countdown" || this.phase === "racing" || this.phase === "done";
  }

  /** Tell the room I passed a gate or finished. */
  gate(gate: number, time: number, last: boolean): void {
    if (!this.racing || !this.race) return;
    if (last) {
      this.finish = time;
      this.phase = "done";
      this.transport.send({ t: "finish", race: this.race, time });
    } else {
      this.transport.send({ t: "gate", race: this.race, gate, time });
    }
  }

  /** Leave the race (back to solo time trials), e.g. on restart. */
  quitRace(): void {
    this.phase = "free";
    this.race = "";
    this.finish = null;
  }

  leave(): void {
    this.transport.leave();
  }

  /** Where to draw a peer: interpolated a little in the past for smoothness. */
  sample(peer: Peer): Snapshot | null {
    const s = peer.snapshots;
    if (s.length === 0) return null;
    const t = this.now() - INTERPOLATION_DELAY_MS;
    if (t <= s[0]!.at) return s[0]!;
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1]!;
      const b = s[i]!;
      if (t >= a.at) {
        const f = Math.min((t - a.at) / Math.max(b.at - a.at, 1), 1);
        let dy = b.yaw - a.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        return { at: t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, yaw: a.yaw + dy * f };
      }
    }
    return s.at(-1)!;
  }

  /** Everyone in the current race (or everyone, between races), best first. */
  standings(me: { x: number; z: number; next: number }): Standing[] {
    const list: Standing[] = [
      { id: this.selfId, name: this.name, colour: this.colour, self: true, finish: this.finish, gates: Math.max(me.next - 1, 0), progress: this.progressOf(me.x, me.z) },
    ];
    for (const p of this.peers.values()) {
      if (this.race && p.race !== this.race) continue;
      const last = p.snapshots.at(-1);
      list.push({
        id: p.id,
        name: p.name,
        colour: p.colour,
        self: false,
        finish: p.finish,
        gates: Math.max(p.next - 1, 0),
        progress: last ? this.progressOf(last.x, last.z) : 0,
      });
    }
    return list.sort((a, b) => {
      if (a.finish !== null || b.finish !== null) return (a.finish ?? Infinity) - (b.finish ?? Infinity);
      return b.gates - a.gates || b.progress - a.progress;
    });
  }

  private hello(to?: string): void {
    this.transport.send({ t: "hello", name: this.name, colour: this.colour }, to);
  }

  private beginCountdown(race: string, ms: number): void {
    this.race = race;
    this.finish = null;
    for (const p of this.peers.values()) p.finish = null;
    this.phase = "countdown";
    this.goAt = this.now() + ms;
    // Everyone sorts the room the same way, so slots don't collide.
    const ids = [this.selfId, ...this.peers.keys()].sort();
    this.events.countdown(ids.indexOf(this.selfId));
  }

  private receive(from: string, m: NetMessage): void {
    const peer = this.peers.get(from);
    switch (m.t) {
      case "ping":
        this.transport.send({ t: "pong", at: m.at }, from);
        return;
      case "pong":
        this.rtt.set(from, this.now() - m.at);
        return;
      case "hello":
        if (peer) {
          peer.name = m.name.slice(0, 24) || "Skier";
          peer.colour = /^#[0-9a-f]{6}$/i.test(m.colour) ? m.colour : peer.colour;
          this.events.peersChanged();
        }
        return;
      case "countdown": {
        // Allow for the message's trip here (half a round trip), so we go together.
        const late = (this.rtt.get(from) ?? 0) / 2;
        this.beginCountdown(m.race, Math.max(m.seconds * 1000 - late, 0));
        return;
      }
      case "pos": {
        if (!peer) return;
        peer.snapshots.push({ at: this.now(), x: m.x, y: m.y, z: m.z, yaw: m.yaw });
        if (peer.snapshots.length > 20) peer.snapshots.shift();
        peer.race = m.race;
        peer.time = m.time;
        peer.next = m.next;
        return;
      }
      case "gate":
        if (peer && m.race === this.race) peer.next = Math.max(peer.next, m.gate + 1);
        return;
      case "finish":
        if (peer && m.race === this.race) {
          peer.finish = m.time;
          this.events.peersChanged();
        }
        return;
    }
  }
}

export function colourFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLOURS[h % COLOURS.length]!;
}

function round<T extends Record<string, number>>(o: T): T {
  const out = {} as Record<string, number>;
  for (const [k, v] of Object.entries(o)) out[k] = Math.round(v * 100) / 100;
  return out as T;
}
