import { isNetMessage, type NetMessage } from "./protocol";
import { randomId, type Transport } from "./transport";
import type { ClientFrame, ServerFrame } from "./wire";

/** The little of a WebSocket we use (so tests can plug in a fake). */
export interface Socket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
}

const OPEN = 1;

/** Where the game server is: `?server=` in the link, or ours on fly.io. */
export const DEFAULT_SERVER = "wss://slop-bondi-ski.fly.dev";

export function serverUrl(): string {
  try {
    return new URLSearchParams(location.search).get("server") || DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}

/**
 * A room on the game server: everyone connects to it rather than to each other, and in a
 * deathmatch it judges the fight (`refereed`). Reconnects by itself if the connection
 * drops, keeping our id so we come back as ourselves.
 */
export class ServerTransport implements Transport {
  readonly selfId = randomId();
  readonly refereed = true;
  private socket: Socket | null = null;
  private readonly peers = new Set<string>();
  private readonly queue: string[] = [];
  private readonly messageFns: ((from: string, m: NetMessage) => void)[] = [];
  private readonly joinFns: ((id: string) => void)[] = [];
  private readonly leaveFns: ((id: string) => void)[] = [];
  private closed = false;
  private retry = 500;

  constructor(
    private readonly url: string,
    private readonly room: string,
    private readonly open: (url: string) => Socket = (u) => new WebSocket(u) as unknown as Socket,
  ) {
    this.connect();
  }

  peerIds(): string[] {
    return [...this.peers];
  }

  send(message: NetMessage, to?: string): void {
    const frame: ClientFrame = to ? { k: "msg", to, m: message } : { k: "msg", m: message };
    const data = JSON.stringify(frame);
    if (this.socket?.readyState === OPEN) this.socket.send(data);
    // Positions go stale; only keep the occasional messages until we're connected.
    else if (message.t !== "state" && message.t !== "pos" && this.queue.length < 50) this.queue.push(data);
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
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    const socket = this.open(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.retry = 500;
      const join: ClientFrame = { k: "join", room: this.room, id: this.selfId };
      socket.send(JSON.stringify(join));
      for (const data of this.queue.splice(0)) socket.send(data);
    };
    socket.onmessage = (e) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(e.data)) as ServerFrame;
      } catch {
        return;
      }
      this.receive(frame);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      for (const id of [...this.peers]) this.drop(id);
      if (this.closed) return;
      setTimeout(() => {
        if (!this.closed) this.connect();
      }, this.retry);
      this.retry = Math.min(this.retry * 2, 8000);
    };
  }

  private receive(f: ServerFrame): void {
    switch (f.k) {
      case "peers":
        for (const id of f.ids) this.add(id);
        return;
      case "join":
        this.add(f.id);
        return;
      case "leave":
        this.drop(f.id);
        return;
      case "msg":
        if (isNetMessage(f.m)) for (const fn of this.messageFns) fn(f.from, f.m);
        return;
    }
  }

  private add(id: string): void {
    if (id === this.selfId || this.peers.has(id)) return;
    this.peers.add(id);
    for (const fn of this.joinFns) fn(id);
  }

  private drop(id: string): void {
    if (!this.peers.delete(id)) return;
    for (const fn of this.leaveFns) fn(id);
  }
}
