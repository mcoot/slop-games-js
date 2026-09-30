import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { heightAt } from "../src/course/data";
import { Referee, defaultRefereeSettings, type RefereeEvents } from "../src/combat/referee";
import { WEAPONS } from "../src/combat/weapons";
import { CombatSession, type CombatEvents } from "../src/net/combat";
import { ServerTransport, type Socket } from "../src/net/server";
import type { ClientFrame, ServerFrame } from "../src/net/wire";
import { Room } from "../server/room";
import { loadWorlds, type ArenaWorld } from "../server/worlds";

let worlds: Map<string, ArenaWorld>;
beforeAll(async () => {
  worlds = await loadWorlds(fileURLToPath(new URL("../public/", import.meta.url)), ["marks-park"]);
});

const DT = 1 / 60;

function referee(log: string[]) {
  const arena = worlds.get("marks-park")!;
  const events: RefereeEvents = {
    hurt: (v, by, w, hit, hp) => log.push(`hurt ${v} by ${by} ${w.id} ${Math.round(hit.damage)} -> ${Math.round(hp)}`),
    died: (v, by) => log.push(`died ${v} by ${by}`),
    spawn: () => {},
    match: () => {},
  };
  const r = new Referee(arena.world, arena.course.terrain, arena.layout, { ...defaultRefereeSettings, game: "ffa" }, events, () => 0.5);
  // High over the middle of the park: nothing in the way.
  const c = arena.layout.centre;
  const y = heightAt(arena.course.terrain, c.x, c.z) + 40;
  return { r, c, y };
}

describe("the referee", () => {
  it("hits a fast skier where they are now, allowing for how old their state is", () => {
    const log: string[] = [];
    const { r, c, y } = referee(log);
    const shooter = r.join("shooter");
    const skier = r.join("skier");
    shooter.latency = 0.05;
    skier.latency = 0.05;
    r.state("shooter", { x: c.x, y, z: c.z + 30, vx: 0, vy: 0, vz: 0, air: false });
    // Crossing in front at 30 m/s; the state was sent 50 ms before it arrived.
    r.state("skier", { x: c.x - 10, y, z: c.z, vx: 30, vy: 0, vz: 0, air: false });
    // The shooter, who sees them where they are now (they predict too), fired 50 ms ago
    // (the shot's on its way here), leading them by the disc's flight time.
    const disc = WEAPONS.disc;
    let aimX = c.x;
    for (let k = 0; k < 5; k++) aimX = c.x - 10 + 30 * (Math.hypot(aimX - c.x, 30) / disc.speed);
    const d = Math.hypot(aimX - c.x, 30);
    r.fire("shooter", "disc", { x: c.x, y: y + 1, z: c.z + 30 }, { x: ((aimX - c.x) / d) * disc.speed, y: 0, z: (-30 / d) * disc.speed });
    for (let i = 1; i <= 90; i++) {
      r.step(DT);
      // Their states keep arriving, 50 ms old, every 50 ms.
      if (i % 3 === 0) r.state("skier", { x: c.x - 10 + 30 * i * DT, y, z: c.z, vx: 30, vy: 0, vz: 0, air: false });
    }
    expect(log).toEqual([expect.stringMatching(/^hurt skier by shooter disc 700/)]);
  });

  it("owns deaths, respawns and the score", () => {
    const log: string[] = [];
    const { r, c, y } = referee(log);
    r.join("a");
    const b = r.join("b");
    r.state("a", { x: c.x, y, z: c.z + 10, vx: 0, vy: 0, vz: 0, air: false });
    r.state("b", { x: c.x, y, z: c.z, vx: 0, vy: 0, vz: 0, air: false });
    for (let shot = 0; shot < 2; shot++) {
      r.fire("a", "disc", { x: c.x, y: y + 1, z: c.z + 9 }, { x: 0, y: 0, z: -WEAPONS.disc.speed });
      for (let i = 0; i < 30; i++) r.step(DT);
      r.state("b", { x: c.x, y, z: c.z, vx: 0, vy: 0, vz: 0, air: false });
    }
    expect(log).toContain("died b by a");
    expect(r.match.kills.get("a")).toBe(1);
    expect(b.fighter.alive).toBe(false);
    for (let i = 0; i < 4 / DT; i++) r.step(DT);
    expect(b.fighter.alive).toBe(true);
  });
});

/** A client connected straight to a room (no network in between). */
function connect(room: Room): Socket & { frames: ServerFrame[] } {
  let id = "";
  const socket = {
    readyState: 0,
    frames: [] as ServerFrame[],
    onopen: null as (() => void) | null,
    onmessage: null as ((e: { data: unknown }) => void) | null,
    onclose: null as (() => void) | null,
    send(data: string) {
      const f = JSON.parse(data) as ClientFrame;
      if (f.k === "join") {
        id = f.id;
        room.add(id, (frame) => {
          socket.frames.push(frame);
          socket.onmessage?.({ data: JSON.stringify(frame) });
        });
      } else room.receive(id, f.m, f.to);
    },
    close() {
      room.remove(id);
    },
  };
  queueMicrotask(() => {
    socket.readyState = 1;
    socket.onopen?.();
  });
  return socket;
}

describe("a server room", () => {
  it("passes messages on, judges deathmatch damage itself, and ignores players' claims", async () => {
    const room = new Room("dm-test", worlds, () => 0);
    const seen: Record<string, string[]> = { a: [], b: [] };
    const mk = (name: "a" | "b", since: number) => {
      const events: CombatEvents = {
        peersChanged() {},
        fire: (_from, m) => seen[name]!.push(`fire ${m.w}`),
        hurt: (victim, m) => seen[name]!.push(`hurt ${victim === sessions.a?.selfId ? "a" : "b"} ${m.dmg}`),
        died: (victim) => seen[name]!.push(`died ${victim === sessions.a?.selfId ? "a" : "b"}`),
        match: () => seen[name]!.push("match"),
        hit: (m) => seen[name]!.push(`hit ${m.dmg} hp ${m.hp}`),
        spawn: () => seen[name]!.push("spawn"),
      };
      const t = new ServerTransport("ws://test", "dm-test", () => connect(room));
      return new CombatSession(t, name, events, () => 0, { since, map: "marks-park", game: "ffa" });
    };
    const sessions: { a?: CombatSession; b?: CombatSession } = {};
    sessions.a = mk("a", 1000);
    await Promise.resolve();
    sessions.b = mk("b", 2000);
    await Promise.resolve();
    const { a, b } = sessions as { a: CombatSession; b: CombatSession };
    expect(room.referee).not.toBeNull();
    expect(a.peers.get(b.selfId)?.name).toBe("b");

    const arena = worlds.get("marks-park")!;
    const c = arena.layout.centre;
    const y = heightAt(arena.course.terrain, c.x, c.z) + 40;
    const state = (z: number) => ({ x: c.x, y, z, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, alive: true, hp: 900, w: "disc", air: false });
    a.tick(state(c.z + 10));
    b.tick(state(c.z));
    // b claims a hurt them: nobody hears it.
    b.transport.send({ t: "hurt", by: a.selfId, w: "disc", dmg: 900, hp: 0, midair: false });
    b.transport.send({ t: "died", by: a.selfId, w: "disc" });
    expect(seen.a).not.toContain("hurt b 900");
    expect(seen.a).not.toContain("died b");
    // a fires straight at b: the server decides.
    a.fire({ w: "disc", x: c.x, y: y + 1, z: c.z + 9, vx: 0, vy: 0, vz: -WEAPONS.disc.speed });
    expect(seen.b).toContain("fire disc");
    for (let i = 0; i < 30; i++) room.step(DT);
    expect(seen.b).toContain("hit 700 hp 200");
    expect(seen.a).toContain("hurt b 700");
    a.leave();
    b.leave();
    expect(room.empty).toBe(true);
  });
});
