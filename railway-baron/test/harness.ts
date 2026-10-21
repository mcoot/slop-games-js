import { WebSocket } from "ws";
import { startServer, type ServerOptions } from "../server/app";
import { StubOracle } from "../server/oracle";
import type { ClientFrame, RoomView, ServerFrame } from "../src/shared/wire";

export const CODE = "let-me-in";

/** A real server on a free port, with the pretend robot. */
export async function server(o: Partial<ServerOptions> = {}) {
  const oracle = new StubOracle();
  const s = await startServer({ port: 0, accessCode: CODE, oracle, callsPerDay: 1000, roundMs: 60_000, ...o });
  return { ...s, oracle: (o.oracle as StubOracle | undefined) ?? oracle, url: `ws://127.0.0.1:${s.port}` };
}

let tokens = 0;

/** A player on a real WebSocket, keeping the latest state the server sent. */
export class Player {
  readonly ws: WebSocket;
  view: RoomView | null = null;
  errors: string[] = [];
  taunts: string[] = [];
  closed = false;
  readonly token: string;
  private waiters: (() => void)[] = [];

  constructor(url: string, token?: string) {
    this.token = token ?? `testtoken${String(++tokens).padStart(8, "0")}`;
    this.ws = new WebSocket(url);
    this.ws.on("message", (d) => {
      const f = JSON.parse(String(d)) as ServerFrame;
      if (f.k === "state") this.view = f.view;
      if (f.k === "error") this.errors.push(f.message);
      if (f.k === "taunt") this.taunts.push(f.taunt);
      this.wake();
    });
    this.ws.on("close", () => {
      this.closed = true;
      this.wake();
    });
  }

  private wake() {
    for (const w of this.waiters.splice(0)) w();
  }

  async open(): Promise<this> {
    if (this.ws.readyState !== WebSocket.OPEN) await new Promise((r) => this.ws.once("open", r));
    return this;
  }

  send(f: ClientFrame | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(f));
  }

  /** Wait until the latest state (or this player) passes the test. */
  async until(test: (v: RoomView, p: this) => boolean, ms = 2000): Promise<RoomView> {
    const end = Date.now() + ms;
    for (;;) {
      if (this.view && test(this.view, this)) return this.view;
      if (this.closed) throw new Error(`closed waiting; errors: ${this.errors.join(" / ")}`);
      const left = end - Date.now();
      if (left <= 0) throw new Error(`timed out; state: ${JSON.stringify(this.view)}; errors: ${this.errors.join(" / ")}`);
      await new Promise<void>((r) => {
        const t = setTimeout(r, left);
        this.waiters.push(() => {
          clearTimeout(t);
          r();
        });
      });
    }
  }

  async untilClosed(ms = 2000): Promise<void> {
    const end = Date.now() + ms;
    while (!this.closed) {
      if (Date.now() > end) throw new Error("still open");
      await new Promise<void>((r) => {
        const t = setTimeout(r, end - Date.now());
        this.waiters.push(() => {
          clearTimeout(t);
          r();
        });
      });
    }
  }

  close(): void {
    this.ws.close();
  }
}

export async function baron(url: string, name = "Baron"): Promise<Player> {
  const p = await new Player(url).open();
  p.send({ k: "create", code: CODE, name, token: p.token });
  await p.until((v) => v.role === "baron");
  return p;
}

export async function rescuer(url: string, room: string, name = "Rescuer", token?: string): Promise<Player> {
  const p = await new Player(url, token).open();
  p.send({ k: "join", room, name, token: p.token });
  await p.until((v) => v.room === room);
  return p;
}

/** A baron with an accepted answer and rescuers, round started. */
export async function started(url: string, answer: string, rescuers = 1) {
  const b = await baron(url);
  const room = b.view!.room;
  const rs: Player[] = [];
  for (let i = 0; i < rescuers; i++) rs.push(await rescuer(url, room, `R${i + 1}`));
  b.send({ k: "secret", answer, notes: "" });
  await b.until((v) => v.ready);
  b.send({ k: "start" });
  for (const r of rs) await r.until((v) => v.phase === "playing");
  return { b, rs, room };
}
