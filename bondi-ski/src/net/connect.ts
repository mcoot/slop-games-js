import { ServerTransport, serverUrl } from "./server";
import type { Transport } from "./transport";

/**
 * Open a connection to a room on the game server (`?server=` points at another one,
 * e.g. `ws://localhost:8787` for a server running locally).
 */
export function connect(room: string): Transport {
  return new ServerTransport(serverUrl(), room);
}
