import { trysteroTransport } from "./trystero";
import { localTransport, type Transport } from "./transport";

/**
 * Open a connection to a room: over the internet (Trystero) by default, or only between
 * tabs in this browser with `?net=local`, for trying races on one computer offline.
 */
export function connect(room: string): { transport: Transport; reach: "this computer" | "internet" } {
  if (new URLSearchParams(location.search).get("net") === "local") return { transport: localTransport(room), reach: "this computer" };
  return { transport: trysteroTransport(room), reach: "internet" };
}
