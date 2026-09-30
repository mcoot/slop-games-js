import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { Room } from "./room";
import { loadWorlds } from "./worlds";
import { ID_PATTERN, ROOM_PATTERN, type ClientFrame, type ServerFrame } from "../src/net/wire";

/**
 * Bondi Ski's game server: rooms over WebSockets, with deathmatch damage judged here.
 * `PORT` (default 8787) and `DATA_DIR` (the game's public/ folder, with course/ and maps/).
 */
const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DATA_DIR ?? fileURLToPath(new URL("../public/", import.meta.url));
/** Simulation ticks per second. */
const TICK_RATE = 60;
const MAX_FRAME_BYTES = 4096;
const MAX_ROOM_SIZE = 16;

const worlds = await loadWorlds(DATA_DIR);
const rooms = new Map<string, Room>();

const http = createServer((req, res) => {
  // Health checks, and a quick look at what's going on.
  res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.members.size, 0) }));
});

const wss = new WebSocketServer({ server: http, maxPayload: MAX_FRAME_BYTES });

wss.on("connection", (socket: WebSocket) => {
  let room: Room | null = null;
  let id = "";
  const send = (f: ServerFrame) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(f));
  };
  socket.on("message", (data) => {
    let f: ClientFrame;
    try {
      f = JSON.parse(String(data)) as ClientFrame;
    } catch {
      return;
    }
    if (!room) {
      if (f.k !== "join" || !ROOM_PATTERN.test(f.room) || !ID_PATTERN.test(f.id)) return socket.close(1008, "join first");
      let r = rooms.get(f.room);
      if (!r) rooms.set(f.room, (r = new Room(f.room, worlds)));
      if (r.members.size >= MAX_ROOM_SIZE && !r.members.has(f.id)) return socket.close(1008, "room full");
      room = r;
      id = f.id;
      room.add(id, send);
      return;
    }
    if (f.k === "msg") room.receive(id, f.m, typeof f.to === "string" ? f.to : undefined);
  });
  socket.on("close", () => {
    if (!room) return;
    // Only if this connection is still theirs (a reconnect replaces it).
    if (room.members.get(id)?.send === send) room.remove(id);
    if (room.empty) rooms.delete(room.name);
  });
});

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  // A stalled event loop shouldn't fire projectiles through walls.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  for (const r of rooms.values()) r.step(dt);
}, 1000 / TICK_RATE);
setInterval(() => {
  for (const r of rooms.values()) r.ping();
}, 1000);

http.listen(PORT, () => console.log(`bondi-ski server on :${PORT}, ${worlds.size} maps`));
