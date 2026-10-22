import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { NAME_MAX, ROOM_PATTERN, TOKEN_PATTERN, type ClientFrame, type ServerFrame } from "../src/shared/wire";
import type { Lookup } from "./facts";
import type { Oracle } from "./oracle";
import { Room, clean, type Budget } from "./room";

export interface ServerOptions {
  port: number;
  /**
   * Needed to create a room. With none set, nobody can create one: the server never
   * runs open by accident.
   */
  accessCode: string | undefined;
  oracle: Oracle;
  /** Model calls the whole server makes in a (UTC) day before the robot goes on strike. */
  callsPerDay: number;
  roundMs: number;
  lookup?: Lookup;
  /** Behind fly.io's proxy, the player's IP is in `fly-client-ip`. */
  trustProxy?: boolean;
  /** How long a room with nobody in it lives. */
  idleMs?: number;
  now?: () => number;
}

const MAX_FRAME_BYTES = 4096;
/** Wrong access codes from one IP before it's locked out for a while. */
const CODE_TRIES = 5;
const CODE_WINDOW_MS = 10 * 60_000;
const CREATES_PER_HOUR = 10;
const CONNECTIONS_PER_MINUTE = 30;
const JOIN_TIMEOUT_MS = 10_000;

/** Counts hits per key in a sliding window. */
class Limiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}
  /** Would one more hit go over? */
  full(key: string): boolean {
    const t = this.now();
    const h = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (h.length) this.hits.set(key, h);
    else this.hits.delete(key);
    return h.length >= this.max;
  }
  hit(key: string): void {
    const h = this.hits.get(key) ?? [];
    h.push(this.now());
    this.hits.set(key, h);
  }
}

class DailyBudget implements Budget {
  used = 0;
  private day = "";
  constructor(
    readonly perDay: number,
    private readonly now: () => number,
  ) {}
  private roll(): void {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
  }
  get spent(): boolean {
    this.roll();
    return this.used >= this.perDay;
  }
  take(): boolean {
    if (this.spent) return false;
    this.used++;
    return true;
  }
}

const sha = (s: string) => createHash("sha256").update(s).digest();
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const roomCode = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/** The game server: rooms over WebSockets, and the only thing that talks to the model. */
export async function startServer(o: ServerOptions) {
  const now = o.now ?? Date.now;
  const rooms = new Map<string, Room>();
  const budget = new DailyBudget(o.callsPerDay, now);
  const wrongCodes = new Limiter(CODE_TRIES, CODE_WINDOW_MS, now);
  const creates = new Limiter(CREATES_PER_HOUR, 60 * 60_000, now);
  const connections = new Limiter(CONNECTIONS_PER_MINUTE, 60_000, now);
  const code = o.accessCode ? sha(o.accessCode) : null;

  const ipOf = (req: IncomingMessage) =>
    (o.trustProxy && typeof req.headers["fly-client-ip"] === "string" ? req.headers["fly-client-ip"] : req.socket.remoteAddress) ?? "?";

  const http = createServer((_req, res) => {
    // Health checks, and a quick look at what's going on.
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    let players = 0;
    for (const r of rooms.values()) players += r.connected;
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players, callsToday: budget.used, callsPerDay: budget.perDay }));
  });

  const wss = new WebSocketServer({ server: http, maxPayload: MAX_FRAME_BYTES });

  wss.on("connection", (socket: WebSocket, req) => {
    const ip = ipOf(req);
    if (connections.full(ip)) return socket.close(1008, "slow down");
    connections.hit(ip);
    let room: Room | null = null;
    let id = "";
    const send = (f: ServerFrame) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(f));
    };
    const refuse = (message: string) => {
      send({ k: "error", message, fatal: true });
      socket.close(1008, message.slice(0, 100));
    };
    const timeout = setTimeout(() => !room && socket.close(1008, "join first"), JOIN_TIMEOUT_MS);

    socket.on("message", (data) => {
      let f: ClientFrame;
      try {
        f = JSON.parse(String(data)) as ClientFrame;
      } catch {
        return;
      }
      if (!f || typeof f !== "object") return;
      if (room) return room.handle(id, f);

      const token = (f as { token?: unknown }).token;
      if ((f.k !== "create" && f.k !== "join") || typeof token !== "string" || !TOKEN_PATTERN.test(token)) return refuse("join first");
      const name = clean(f.name, NAME_MAX) || "Someone";

      if (f.k === "create") {
        // The only way a room comes into being.
        if (!code) return refuse("This server isn't taking new rooms.");
        if (wrongCodes.full(ip)) return refuse("Too many wrong codes. Try again later.");
        const given = typeof f.code === "string" ? sha(f.code) : null;
        if (!given || !timingSafeEqual(given, code)) {
          wrongCodes.hit(ip);
          return refuse("That's not the access code.");
        }
        if (creates.full(ip)) return refuse("That's a lot of rooms. Try again later.");
        creates.hit(ip);
        let name_ = roomCode();
        while (rooms.has(name_)) name_ = roomCode();
        room = new Room(name_, { oracle: o.oracle, budget, roundMs: o.roundMs, lookup: o.lookup, now });
        rooms.set(name_, room);
        id = room.sit(token, name, "baron", send)!;
      } else {
        const r = typeof f.room === "string" && ROOM_PATTERN.test(f.room) ? rooms.get(f.room) : undefined;
        if (!r) return refuse("There's no room by that code (it may have closed).");
        const seat = r.sit(token, name, "rescuer", send);
        if (!seat) return refuse("That room is full.");
        room = r;
        id = seat;
      }
      clearTimeout(timeout);
    });

    // Oversized or broken frames: ws closes the connection itself.
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(timeout);
      room?.leave(id, send);
    });
  });

  const ticker = setInterval(() => {
    const t = now();
    for (const [name, r] of rooms) {
      r.tick();
      if (!r.connected && t - r.emptySince > (o.idleMs ?? 5 * 60_000)) rooms.delete(name);
    }
  }, 200);

  await new Promise<void>((resolve) => http.listen(o.port, resolve));

  return {
    port: (http.address() as AddressInfo).port,
    rooms,
    budget,
    async close() {
      clearInterval(ticker);
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
