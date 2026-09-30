import { trysteroTransport } from "./trystero";
import { ServerTransport, serverUrl } from "./server";
import { localTransport, type Transport } from "./transport";

export type Reach = "this computer" | "internet" | "game server";

/**
 * Open a connection to a room: over the internet (Trystero) by default, through the game
 * server with `?net=server` (it judges deathmatch damage), or only between tabs in this
 * browser with `?net=local`, for trying races on one computer offline.
 */
export function connect(room: string): { transport: Transport; reach: Reach } {
  const net = new URLSearchParams(location.search).get("net");
  if (net === "local") return { transport: localTransport(room), reach: "this computer" };
  if (net === "server") return { transport: new ServerTransport(serverUrl(), room), reach: "game server" };
  return { transport: trysteroTransport(room), reach: "internet" };
}
