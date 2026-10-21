import type { ClientFrame, RoomView, ServerFrame, Taunt } from "./shared/wire";

/** Where the game server is: `?server=` in the link, a local one in dev, or ours on fly.io. */
export function serverUrl(): string {
  const q = new URLSearchParams(location.search).get("server");
  if (q) return q;
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return "ws://localhost:8788";
  return "wss://slop-railway-baron.fly.dev";
}

/** This tab's private token: it gets us back into our seat if the connection drops. */
export function myToken(): string {
  const key = "railway-baron-token";
  try {
    const t = sessionStorage.getItem(key);
    if (t) return t;
  } catch {}
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const t = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => abc[b % abc.length]).join("");
  try {
    sessionStorage.setItem(key, t);
  } catch {}
  return t;
}

export interface Handlers {
  state(v: RoomView): void;
  error(message: string, fatal: boolean): void;
  taunt(t: Taunt): void;
  /** Lost the connection; trying again. */
  reconnecting(): void;
}

/**
 * Our connection to a room. Opens with a create or join; once in a room, a dropped
 * connection rejoins it by itself (with our token, so we keep our seat).
 */
export class Connection {
  private socket: WebSocket | null = null;
  private room: string | null = null;
  private closed = false;
  private retry = 500;

  constructor(
    private readonly url: string,
    private first: ClientFrame,
    private readonly name: string,
    private readonly h: Handlers,
  ) {
    this.open();
  }

  send(f: ClientFrame): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(f));
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
  }

  private open(): void {
    const s = new WebSocket(this.url);
    this.socket = s;
    let fatal = false;
    s.onopen = () => s.send(JSON.stringify(this.first));
    s.onmessage = (e) => {
      const f = JSON.parse(String(e.data)) as ServerFrame;
      if (f.k === "state") {
        this.retry = 500;
        // From now on, coming back means rejoining this room.
        if (this.room !== f.view.room) {
          this.room = f.view.room;
          this.first = { k: "join", room: f.view.room, name: this.name, token: myToken() };
        }
        this.h.state(f.view);
      } else if (f.k === "error") {
        if (f.fatal) fatal = true;
        this.h.error(f.message, !!f.fatal);
      } else if (f.k === "taunt") this.h.taunt(f.taunt);
    };
    s.onclose = () => {
      if (this.socket !== s || this.closed || fatal) return;
      // Only keep trying once we've been in a room (a refused create shouldn't loop).
      if (!this.room) return this.h.error("Couldn't reach the game server.", true);
      this.h.reconnecting();
      setTimeout(() => !this.closed && this.open(), this.retry);
      this.retry = Math.min(this.retry * 2, 8000);
    };
  }
}
