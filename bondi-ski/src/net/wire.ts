import type { NetMessage } from "./protocol";

/**
 * Between a player and the game server (JSON over a WebSocket). The server relays
 * players' messages to each other, and speaks for itself as `SERVER_ID`: pings, and in a
 * deathmatch the damage, deaths, respawns and matches it judges.
 */
export type ClientFrame =
  /** First thing on connecting: the room, and who I am (my id is mine to pick). */
  | { k: "join"; room: string; id: string }
  /** A message for everyone in the room, or one of them (or the server). */
  | { k: "msg"; to?: string; m: NetMessage };

export type ServerFrame =
  /** Who's already in the room when you join. */
  | { k: "peers"; ids: string[] }
  | { k: "join"; id: string }
  | { k: "leave"; id: string }
  | { k: "msg"; from: string; m: NetMessage };

export const SERVER_ID = "server";

/** Room names and player ids: short and plain. */
export const ROOM_PATTERN = /^[a-z0-9-]{1,40}$/;
export const ID_PATTERN = /^[a-z0-9]{4,16}$/;
