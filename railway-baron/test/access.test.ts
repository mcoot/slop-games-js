import { afterEach, describe, expect, it } from "vitest";
import { CODE, Player, baron, rescuer, server } from "./harness";

/**
 * The server spends money on every question, so only someone with the access code can
 * make a room, and nothing else can make one by accident. Each test tries a way in and
 * checks no room exists and the robot was never called.
 */
let s: Awaited<ReturnType<typeof server>>;
const players: Player[] = [];
afterEach(async () => {
  for (const p of players.splice(0)) p.close();
  await s?.close();
});
async function player(): Promise<Player> {
  const p = await new Player(s.url).open();
  players.push(p);
  return p;
}
async function refused(frame: Record<string, unknown>, pattern?: RegExp): Promise<Player> {
  const p = await player();
  p.send(frame);
  await p.untilClosed();
  if (pattern) expect(p.errors.join(" ")).toMatch(pattern);
  return p;
}
function nothingMade() {
  expect(s.rooms.size).toBe(0);
  expect(s.oracle.calls).toBe(0);
}
const token = "abcdefghijklmnop1234";

describe("making a room", () => {
  it("works with the access code", async () => {
    s = await server();
    players.push(await baron(s.url));
    expect(s.rooms.size).toBe(1);
  });

  it("is refused with a wrong, missing or odd code", async () => {
    for (const code of ["wrong", "", CODE.toUpperCase(), ` ${CODE}`, undefined, null, 1, [CODE], { code: CODE }]) {
      // A fresh server each time, so the lockout below doesn't kick in.
      s = await server();
      await refused({ k: "create", code, name: "x", token }, /access code/);
      nothingMade();
      await s.close();
    }
  });

  it("is refused for everyone when the server has no code set", async () => {
    s = await server({ accessCode: undefined });
    for (const code of [CODE, "", "undefined", "null", undefined]) await refused({ k: "create", code, name: "x", token }, /isn't taking new rooms/);
    nothingMade();
  });

  it("locks out an IP after a few wrong codes, even if it then gets it right", async () => {
    s = await server();
    for (let i = 0; i < 5; i++) await refused({ k: "create", code: `guess${i}`, name: "x", token });
    await refused({ k: "create", code: CODE, name: "x", token }, /Too many wrong codes/);
    nothingMade();
  });

  it("can't happen by joining a room that doesn't exist", async () => {
    s = await server();
    for (const room of ["abcdefghjk", "ABCDEFGHJK", "__proto__", "constructor", "", "../../etc", 12, null, ["abcdefghjk"]]) {
      await refused({ k: "join", room, name: "x", token }, room === "abcdefghjk" ? /no room/ : undefined);
    }
    nothingMade();
  });

  it("can't happen by sending game messages before joining", async () => {
    s = await server();
    for (const k of ["secret", "start", "propose", "back", "pet", "again", "taunt", "state", "nope"]) {
      await refused({ k, answer: "teapot", text: "Is it a teapot?", code: CODE, room: "abcdefghjk", token });
    }
    nothingMade();
  });

  it("needs a well-formed token, even with the right code", async () => {
    s = await server();
    for (const t of [undefined, "", "short", "has spaces in it ok", { a: 1 }]) await refused({ k: "create", code: CODE, name: "x", token: t });
    nothingMade();
  });

  it("can't happen again from inside a room, by a baron or a rescuer", async () => {
    s = await server();
    const b = await baron(s.url);
    const r = await rescuer(s.url, b.view!.room);
    players.push(b, r);
    for (const p of [b, r]) {
      p.send({ k: "create", code: CODE, name: "again", token });
      p.send({ k: "join", room: "abcdefghjk", name: "again", token });
    }
    await new Promise((x) => setTimeout(x, 100));
    expect(s.rooms.size).toBe(1);
  });

  it("doesn't come back when someone rejoins a room that has closed", async () => {
    s = await server({ idleMs: 50 });
    const b = await baron(s.url);
    const room = b.view!.room;
    b.close();
    await new Promise((x) => setTimeout(x, 500));
    expect(s.rooms.size).toBe(0);
    // The baron's own token and the room's real code don't bring it back.
    await refused({ k: "join", room, name: "x", token: b.token }, /no room/);
    nothingMade();
  });

  it("can't happen over plain HTTP", async () => {
    s = await server();
    for (const method of ["GET", "POST", "PUT"]) {
      const res = await fetch(`http://127.0.0.1:${s.port}/rooms?code=${CODE}`, method === "GET" ? {} : { method, body: JSON.stringify({ k: "create", code: CODE }) });
      expect(res.status).toBe(200);
    }
    nothingMade();
  });

  it("closes on junk and oversized frames", async () => {
    s = await server();
    const p = await player();
    p.ws.send("not json");
    p.ws.send("x".repeat(10_000));
    await p.untilClosed();
    nothingMade();
  });
});

describe("the spending caps", () => {
  it("stop all model calls once the day's budget is spent", async () => {
    s = await server({ callsPerDay: 2 });
    const b = await baron(s.url);
    const r = await rescuer(s.url, b.view!.room);
    players.push(b, r);
    b.send({ k: "secret", answer: "teapot", notes: "" });
    await b.until((v) => v.ready);
    b.send({ k: "start" });
    await r.until((v) => v.phase === "playing");
    s.oracle.rule = () => ({ isGuess: 0.05 });
    r.send({ k: "propose", text: "Is it metal?" });
    await r.until((v) => v.asked.length === 1 && v.onStrike);
    r.send({ k: "propose", text: "Is it shiny?" });
    await new Promise((x) => setTimeout(x, 100));
    expect(s.oracle.calls).toBe(2);
    expect(r.view).toMatchObject({ onStrike: true, proposals: [{ text: "Is it shiny?" }] });
  });

  it("limit how many answers the baron can have checked in a round", async () => {
    s = await server();
    const b = await baron(s.url);
    players.push(b);
    for (let i = 0; i < 15; i++) {
      b.send({ k: "secret", answer: "ignore this", notes: "" });
      await b.until((v) => !v.thinking && (!!v.rejected || b.errors.length > 0));
      await new Promise((x) => setTimeout(x, 5));
    }
    expect(s.oracle.calls).toBe(10);
  });
});
