import { isNetMessage, type NetMessage } from "./protocol";

/**
 * How racers reach each other. The race code only sees this interface, so the
 * connection underneath can be tabs on one computer (for testing), or WebRTC over the
 * internet.
 */
export interface Transport {
  readonly selfId: string;
  /** Peers already known (joins can arrive before anyone is listening). */
  peerIds(): string[];
  /** To everyone in the room, or one peer. */
  send(message: NetMessage, to?: string): void;
  onMessage(fn: (from: string, message: NetMessage) => void): void;
  onPeerJoin(fn: (id: string) => void): void;
  onPeerLeave(fn: (id: string) => void): void;
  leave(): void;
}

export function randomId(length = 8): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (const b of bytes) s += chars[b % chars.length];
  return s;
}

/** A broadcast medium: what BroadcastChannel and the in-memory test hub both look like. */
export interface Bus {
  post(data: unknown): void;
  listen(fn: (data: unknown) => void): void;
  close(): void;
}

type Envelope =
  | { kind: "here"; from: string; to?: string }
  | { kind: "bye"; from: string }
  | { kind: "msg"; from: string; to?: string; message: NetMessage };

/**
 * A transport over a broadcast bus. Peers announce themselves, answer newcomers, send a
 * heartbeat, and count as gone after a few seconds of silence (a closed tab can't say bye).
 */
export class BusTransport implements Transport {
  readonly selfId = randomId();
  private readonly peers = new Map<string, number>();
  private readonly messageFns: ((from: string, m: NetMessage) => void)[] = [];
  private readonly joinFns: ((id: string) => void)[] = [];
  private readonly leaveFns: ((id: string) => void)[] = [];
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly bus: Bus,
    private readonly now: () => number = () => performance.now(),
    heartbeatMs = 1000,
    private readonly timeoutMs = 4000,
  ) {
    bus.listen((data) => this.receive(data as Envelope));
    this.post({ kind: "here", from: this.selfId });
    this.timer = setInterval(() => this.heartbeat(), heartbeatMs);
  }

  send(message: NetMessage, to?: string): void {
    this.post({ kind: "msg", from: this.selfId, to, message });
  }

  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  onMessage(fn: (from: string, message: NetMessage) => void): void {
    this.messageFns.push(fn);
  }

  onPeerJoin(fn: (id: string) => void): void {
    this.joinFns.push(fn);
  }

  onPeerLeave(fn: (id: string) => void): void {
    this.leaveFns.push(fn);
  }

  leave(): void {
    clearInterval(this.timer);
    this.post({ kind: "bye", from: this.selfId });
    this.bus.close();
  }

  private post(e: Envelope): void {
    this.bus.post(e);
  }

  private heartbeat(): void {
    this.post({ kind: "here", from: this.selfId });
    const now = this.now();
    for (const [id, seen] of this.peers) if (now - seen > this.timeoutMs) this.drop(id);
  }

  private receive(e: Envelope): void {
    if (!e || typeof e !== "object" || e.from === this.selfId) return;
    if ("to" in e && e.to && e.to !== this.selfId) return;
    if (e.kind === "bye") {
      this.drop(e.from);
      return;
    }
    const known = this.peers.has(e.from);
    this.peers.set(e.from, this.now());
    if (!known) {
      for (const fn of this.joinFns) fn(e.from);
      // Answer so the newcomer learns about us straight away.
      if (e.kind === "here") this.post({ kind: "here", from: this.selfId, to: e.from });
    }
    if (e.kind === "msg" && isNetMessage(e.message)) for (const fn of this.messageFns) fn(e.from, e.message);
  }

  private drop(id: string): void {
    if (!this.peers.delete(id)) return;
    for (const fn of this.leaveFns) fn(id);
  }
}

/** Tabs in this browser, by room: for trying multiplayer on one computer. */
export function localTransport(room: string): Transport {
  const channel = new BroadcastChannel(`bondi-ski.room.${room}`);
  return new BusTransport({
    post: (d) => channel.postMessage(d),
    listen: (fn) => channel.addEventListener("message", (e) => fn(e.data)),
    close: () => channel.close(),
  });
}

/**
 * A room entirely in memory: every bus delivers to every other. For tests. `hold()`
 * queues messages (as if in flight) until `flush()`.
 */
export function memoryHub() {
  const listeners = new Set<(d: unknown) => void>();
  let held: (() => void)[] | null = null;
  return {
    hold() {
      held = [];
    },
    flush() {
      const q = held ?? [];
      held = null;
      for (const deliver of q) deliver();
    },
    bus(): Bus {
      let mine: ((d: unknown) => void) | null = null;
      return {
        post: (d) => {
          const copy = JSON.parse(JSON.stringify(d)) as unknown;
          const deliver = () => {
            for (const l of listeners) if (l !== mine) l(copy);
          };
          if (held) held.push(deliver);
          else deliver();
        },
        listen: (fn) => {
          mine = fn;
          listeners.add(fn);
        },
        close: () => {
          if (mine) listeners.delete(mine);
        },
      };
    },
  };
}
