import * as THREE from "three";
import type { MouseLook } from "@slop/input";
import type { PhysicsWorld } from "@slop/physics";
import type { MovementSettings, PlayerController } from "@slop/fps-controller";
import type { CourseData } from "../course/data";
import type { Jetpack } from "../jetpack";
import type { CoastAudio } from "../audio";
import { Arena, aimOf, type Local } from "../combat/arena";
import type { ArenaLayout } from "../maps";
import type { Target } from "../combat/damage";
import { Fighter } from "../combat/fighter";
import { WEAPONS, type WeaponDef, type WeaponId } from "../combat/weapons";
import { CombatSession } from "../net/combat";
import { colourFor } from "../net/session";
import { randomId, type Transport } from "../net/transport";
import { Explosions, FighterView, ProjectileViews, Viewmodel } from "../view/combat";
import { defaultBotSettings } from "../combat/bot";
import { Lobby } from "./lobby";
import { WorldOverlay, type LabelItem } from "./overlay";
import { RAPIER } from "@slop/physics";

export interface DeathmatchContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: PhysicsWorld;
  course: CourseData;
  layout: ArenaLayout;
  player: PlayerController;
  jet: Jetpack;
  look: MouseLook;
  audio: CoastAudio;
  movement: MovementSettings;
  toast(text: string, seconds?: number): void;
}

export interface DeathmatchSettings {
  /** Kills to win. */
  killTarget: number;
  /** Practice bots when you're not in a room. */
  bots: number;
  /** Seconds of results before the next match. */
  resultsTime: number;
}

const BOT_NAMES = ["Icebergs", "Tamarama", "Mackenzie", "Marks", "Bronte", "Clovelly"];
const BOT_COLOURS = ["#ff6b5e", "#ffa94d", "#b18cff", "#ff8fd8", "#e6f36b", "#3ddc84"];

/**
 * Tribes-style deathmatch on the coast: you, your projectiles and theirs, practice bots
 * when you're on your own, and other players when you're in a room. Everyone keeps
 * skiing and jetting; first to the kill target wins, then a new match starts.
 */
export class Deathmatch {
  readonly settings: DeathmatchSettings = { killTarget: 15, bots: 3, resultsTime: 10 };
  readonly weaponSettings: Record<WeaponId, WeaponDef> = WEAPONS;
  readonly fighter = new Fighter();
  readonly arena: Arena;
  session: CombatSession | null = null;
  readonly lobby: Lobby;
  private readonly me: Local;
  private readonly projectileViews = new ProjectileViews();
  private readonly explosions = new Explosions();
  private readonly viewmodel: Viewmodel;
  private readonly views = new Map<string, FighterView>();
  private readonly overlay = new WorldOverlay();
  /** Line of sight to each enemy, rechecked a few times a second. */
  private readonly sight = new Map<string, { visible: boolean; at: number }>();
  private readonly feed: { text: string; until: number }[] = [];
  private hurtFlash = 0;
  private hitFlash = 0;
  private killedBy = "";
  private outWarned = false;
  private showScores = false;
  private readonly el = {
    hp: document.querySelector<HTMLElement>("#hp")!,
    weapon: document.querySelector<HTMLElement>("#weapon")!,
    hit: document.querySelector<HTMLElement>("#hitmarker")!,
    hurt: document.querySelector<HTMLElement>("#hurtflash")!,
    feed: document.querySelector<HTMLElement>("#feed")!,
    scores: document.querySelector<HTMLElement>("#scores")!,
    matchbar: document.querySelector<HTMLElement>("#matchbar")!,
    dead: document.querySelector<HTMLElement>("#dead")!,
  };

  constructor(private readonly ctx: DeathmatchContext) {
    this.me = { id: "me", body: ctx.player, fighter: this.fighter, jet: ctx.jet };
    this.arena = new Arena(ctx.world, ctx.course, ctx.layout, ctx.movement, this.me, {
      shot: (owner, w, pos, vel) => {
        if (owner === this.me.id) {
          this.session?.fire({ w: w.id, x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z });
          this.viewmodel.fired(w.id === "disc" ? 1 : 0.3);
          ctx.audio.shot(w.id, null);
        } else {
          ctx.audio.shot(w.id, pos);
        }
      },
      impact: (impact) => {
        const w = impact.projectile.weapon;
        if (impact.expired && w.splashRadius === 0) return;
        this.explosions.spawn(impact.point, w.splashRadius);
        ctx.audio.blast(impact.point, w.splashRadius > 0);
      },
      hurt: (victim, by, w, hit, health) => {
        if (victim === this.me.id) {
          if (by !== this.me.id || hit.damage > 0) {
            this.hurtFlash = Math.min(1, this.hurtFlash + hit.damage / 400);
            if (by !== this.me.id) ctx.audio.hurt();
          }
          // Tell the room (not for the arena edge's steady trickle: the death report covers that).
          if (w.id !== "edge") this.session?.hurt(by, w.id, hit.damage, Math.round(health), hit.midair);
        } else if (by === this.me.id) {
          // We hit a bot.
          this.hitMarker(health <= 0, hit.midair);
          const bot = this.arena.bots.find((b) => b.id === victim);
          if (bot) this.damageNumber(bot.body.feet, hit.damage, health <= 0, hit.midair);
        }
      },
      died: (victim, by, w, hit) => {
        this.addFeed(by, victim, w, hit.midair);
        if (victim === this.me.id) {
          this.killedBy = by === this.me.id ? "yourself" : this.nameOf(by);
          this.session?.died(by, w.id);
        }
        this.checkWinner();
      },
      respawned: (id) => {
        if (id === this.me.id) {
          // Face the middle of the course.
          const c = this.arena.centre;
          const f = ctx.player.feet;
          ctx.look.yaw = Math.atan2(-(c.x - f.x), -(c.z - f.z));
          ctx.look.pitch = 0;
        }
      },
    });
    this.viewmodel = new Viewmodel();
    ctx.scene.add(this.projectileViews.root, this.explosions.root);
    this.lobby = new Lobby(
      (t) => this.joinRoom(t),
      () => this.leaveRoom(),
      () => {
        const n = (this.session?.peers.size ?? 0) + 1;
        return `Room ${this.lobby.room} · ${n} ${n === 1 ? "player" : "players"} here · ${this.lobby.reach === "internet" ? "over the internet" : "tabs on this computer only"}`;
      },
    );
    this.lobby.onRename = (name) => this.session?.setName(name);
    this.lobby.joinFromLink();
    if (!this.session) this.startSolo();
    this.newMatch(randomId(6));
    this.arena.respawn(this.me);
  }

  /** Alive (so you can move and shoot). */
  get alive(): boolean {
    return this.fighter.alive;
  }

  /** Called every tick after the player has moved, before the physics step. */
  tick(dt: number, input: { fire: boolean; weapon: WeaponId | "swap" | null; reload: boolean; scores: boolean }): void {
    const f = this.fighter;
    this.showScores = input.scores;
    if (input.weapon && f.alive) {
      const next = input.weapon === "swap" ? (f.current === "disc" ? "rifle" : "disc") : input.weapon;
      if (f.switchTo(next)) this.viewmodel.show(next);
    }
    if (input.reload && f.switching === 0) f.weapon.startReload();
    const matchOver = this.arena.match.over;
    const shots = f.alive ? f.tickWeapons(input.fire && !matchOver, dt) : 0;
    for (let i = 0; i < shots; i++) {
      const p = this.ctx.player;
      const eye = { x: p.feet.x, y: p.feet.y + p.eyeHeight, z: p.feet.z };
      this.arena.fire(this.me.id, f.weapon.def, eye, aimOf(this.ctx.look.yaw, this.ctx.look.pitch), p.velocity);
    }

    this.arena.remoteTargets = this.remoteTargets();
    this.arena.stepBots(dt, (bot) =>
      [this.me, ...this.arena.bots.filter((b) => b !== bot).map((b) => ({ id: b.id, body: b.body, fighter: b.fighter }))].map((l) => ({
        id: l.id,
        feet: { ...l.body.feet },
        velocity: { ...l.body.velocity },
        alive: l.fighter.alive,
      })),
    );
    this.arena.step(dt);

    // The arena edge: a warning, then damage (in the arena's step).
    const c = this.arena.centre;
    const out = Math.hypot(this.ctx.player.feet.x - c.x, this.ctx.player.feet.z - c.z) > this.arena.radius - (this.ctx.layout.walled ? 0 : 30);
    if (out && !this.outWarned && f.alive) this.ctx.toast("Turn back: you're leaving the arena", 2);
    this.outWarned = out;

    const p = this.ctx.player;
    this.session?.tick({
      x: p.feet.x,
      y: p.feet.y,
      z: p.feet.z,
      yaw: this.ctx.look.yaw,
      pitch: this.ctx.look.pitch,
      vx: p.velocity.x,
      vy: p.velocity.y,
      vz: p.velocity.z,
      alive: f.alive,
      hp: Math.round(f.health),
      w: f.current,
      air: !p.grounded,
    });

    // After a match: a break for the results, then a new one.
    const m = this.arena.match;
    if (m.over && this.arena.now() - m.endedAt > this.settings.resultsTime) {
      // One player (the first by id) starts the next match for the room.
      const ids = [this.session?.selfId ?? "", ...(this.session?.peers.keys() ?? [])].sort();
      const id = randomId(6);
      if (!this.session || ids[0] === this.session.selfId) this.session?.startMatch(id, this.settings.killTarget);
      this.newMatch(id);
    }
  }

  /** Called every frame. */
  render(alpha: number, dt: number): void {
    const cam = this.ctx.camera;
    this.projectileViews.update(this.arena.projectiles.list, alpha, dt);
    this.explosions.update(dt);
    this.viewmodel.update(dt, this.fighter.alive, this.ctx.player.horizontalSpeed, this.fighter.switching / Math.max(this.fighter.settings.switchTime, 0.01));
    // Bots and remote players.
    const labels: LabelItem[] = [];
    const head = this.ctx.movement.standHeight + 0.35;
    for (const bot of this.arena.bots) {
      const v = this.viewFor(bot.id, bot.name, bot.colour);
      const f = bot.body.feet;
      v.update({ x: f.x, y: f.y, z: f.z, yaw: bot.yaw, pitch: bot.pitch }, bot.fighter.alive);
      if (bot.fighter.alive) {
        const pos = new THREE.Vector3(f.x, f.y + head, f.z);
        labels.push({ id: bot.id, name: bot.name, colour: bot.colour, pos, health: bot.fighter.health, maxHealth: bot.fighter.settings.maxHealth, visible: this.canSee(bot.id, pos) });
      }
    }
    for (const peer of this.session?.peers.values() ?? []) {
      const v = this.viewFor(peer.id, peer.name, peer.colour);
      const s = this.session!.sample(peer);
      if (!s) continue;
      v.update(s, peer.alive);
      if (peer.alive) {
        const pos = new THREE.Vector3(s.x, s.y + head, s.z);
        labels.push({ id: peer.id, name: peer.name, colour: peer.colour, pos, health: peer.hp, maxHealth: this.fighter.settings.maxHealth, visible: this.canSee(peer.id, pos) });
      }
    }
    this.overlay.update(cam, window.innerWidth, window.innerHeight, labels, dt);
    const forward = new THREE.Vector3();
    cam.getWorldDirection(forward);
    this.ctx.audio.listen(cam.position, forward);
    this.renderHud(dt);
  }

  /** After the world is drawn: the weapon in your hands. */
  drawOverlay(renderer: THREE.WebGLRenderer): void {
    this.viewmodel.render(renderer, this.ctx.camera.aspect);
  }

  dispose(): void {
    this.leaveRoom();
    this.arena.removeBots();
  }

  // ---------------------------------------------------------------- rooms

  private joinRoom(transport: Transport): void {
    this.arena.removeBots();
    this.dropViews();
    this.session = new CombatSession(transport, this.lobby.name, {
      peersChanged: () => {
        this.lobby.render();
        this.syncViews();
      },
      fire: (from, m, age) => {
        const w = this.weaponSettings[m.w as WeaponId];
        if (!w) return;
        this.arena.remoteShot(from, w, { x: m.x, y: m.y, z: m.z }, { x: m.vx, y: m.vy, z: m.vz }, age);
        this.ctx.audio.shot(w.id, { x: m.x, y: m.y, z: m.z });
      },
      hurt: (victim, m) => {
        if (m.by !== this.session?.selfId || victim === m.by) return;
        this.hitMarker(m.hp <= 0, m.midair);
        const peer = this.session.peers.get(victim);
        const at = peer && this.session.sample(peer);
        if (at) this.damageNumber(at, m.dmg, m.hp <= 0, m.midair);
      },
      died: (victim, by, w) => {
        const weapon = this.weaponSettings[w as WeaponId] ?? { name: "the edge of the arena", id: "edge" };
        this.addFeed(by, victim, weapon as WeaponDef, false);
        this.arena.match.recordDeath(victim, by, this.arena.now());
        if (by === this.session?.selfId && victim !== by) this.ctx.toast(`You fragged ${this.nameOf(victim)}`, 1.5);
        this.checkWinner();
      },
      match: (id, target) => {
        if (id !== this.arena.match.id) {
          this.settings.killTarget = target;
          this.newMatch(id);
        }
      },
    });
    // Our own deaths and kills are counted under our id in the room.
    this.me.id = this.session.selfId;
  }

  private leaveRoom(): void {
    this.session?.leave();
    this.session = null;
    this.me.id = "me";
    this.dropViews();
    this.startSolo();
  }

  private startSolo(): void {
    this.arena.removeBots();
    for (let i = 0; i < this.settings.bots; i++) {
      const bot = this.arena.addBot(BOT_NAMES[i % BOT_NAMES.length]!, BOT_COLOURS[i % BOT_COLOURS.length]!);
      bot.settings = { ...defaultBotSettings };
    }
  }

  /** Change the number of practice bots (solo only). */
  setBots(n: number): void {
    this.settings.bots = n;
    if (!this.session) {
      this.dropViews();
      this.startSolo();
    }
  }

  private newMatch(id: string): void {
    this.arena.match.reset(id, this.settings.killTarget);
    this.arena.projectiles.clear();
    for (const l of this.arena.locals()) this.arena.respawn(l);
    this.ctx.toast(`First to ${this.settings.killTarget} kills`, 2.5);
  }

  private checkWinner(): void {
    const m = this.arena.match;
    if (m.over && m.winner) {
      const you = m.winner === this.me.id;
      this.ctx.toast(you ? "You win!" : `${this.nameOf(m.winner)} wins`, 4);
      this.ctx.audio.finish(you);
    }
  }

  // ---------------------------------------------------------------- helpers

  private remoteTargets(): Target[] {
    const out: Target[] = [];
    for (const peer of this.session?.peers.values() ?? []) {
      const s = this.session!.sample(peer);
      if (!s || !peer.alive) continue;
      out.push({ id: peer.id, feet: { x: s.x, y: s.y, z: s.z }, height: this.ctx.movement.standHeight, radius: 0.45, airborne: peer.airborne });
    }
    return out;
  }

  private nameOf(id: string): string {
    if (id === this.me.id) return this.lobby.name;
    const bot = this.arena.bots.find((b) => b.id === id);
    if (bot) return bot.name;
    return this.session?.peers.get(id)?.name ?? "someone";
  }

  private colourOf(id: string): string {
    if (id === this.me.id) return this.session?.colour ?? "#6fd3ff";
    const bot = this.arena.bots.find((b) => b.id === id);
    if (bot) return bot.colour;
    return this.session?.peers.get(id)?.colour ?? colourFor(id);
  }

  private viewFor(id: string, name: string, colour: string): FighterView {
    let v = this.views.get(id);
    if (!v) {
      v = new FighterView(name, colour, this.ctx.movement.standHeight);
      this.ctx.scene.add(v.root);
      this.views.set(id, v);
    }
    return v;
  }

  private syncViews(): void {
    for (const [id, v] of this.views) {
      if (this.arena.bots.some((b) => b.id === id) || this.session?.peers.has(id)) continue;
      v.dispose();
      this.views.delete(id);
    }
    // Names can arrive after the view was made: rebuild those.
    for (const peer of this.session?.peers.values() ?? []) {
      const v = this.views.get(peer.id);
      if (v && v.name !== peer.name) {
        v.dispose();
        this.views.delete(peer.id);
      }
    }
  }

  private dropViews(): void {
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.overlay.clear();
  }

  private damageNumber(feet: { x: number; y: number; z: number }, amount: number, kill: boolean, midair: boolean): void {
    const pos = new THREE.Vector3(feet.x, feet.y + this.ctx.movement.standHeight * 0.75, feet.z);
    this.overlay.damage(pos, amount, kill ? "kill" : midair ? "midair" : "hit");
  }

  /** Is this enemy's head in view from the camera (not behind terrain or a building)? Cached briefly. */
  private canSee(id: string, head: THREE.Vector3): boolean {
    const now = performance.now();
    const c = this.sight.get(id);
    if (c && now - c.at < 150) return c.visible;
    const from = this.ctx.camera.position;
    const d = new THREE.Vector3().subVectors(head, from);
    const len = d.length();
    d.divideScalar(len || 1);
    const hulls = this.arena.hulls();
    const hit = this.ctx.world.castRay(new RAPIER.Ray(from, d), len, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, (col) => !hulls.has(col.handle));
    const visible = hit === null;
    this.sight.set(id, { visible, at: now });
    return visible;
  }

  private hitMarker(kill: boolean, midair: boolean): void {
    this.hitFlash = kill ? 2 : 1;
    this.ctx.audio.hitMarker(kill);
    if (midair) this.ctx.toast(kill ? "MIDAIR KILL!" : "Midair!", 1.2);
  }

  private addFeed(by: string, victim: string, w: WeaponDef, midair: boolean): void {
    const who = (id: string) => `<span style="color:${this.colourOf(id)}">${escape(this.nameOf(id))}</span>`;
    const how = `${w.name}${midair ? " · MIDAIR" : ""}`;
    const text = by === victim ? `${who(victim)} <i>${w.id === "edge" ? "left the arena" : "blew themselves up"}</i>` : `${who(by)} <i>${how}</i> ${who(victim)}`;
    this.feed.push({ text, until: performance.now() + 6000 });
    if (this.feed.length > 5) this.feed.shift();
  }

  private renderHud(dt: number): void {
    const f = this.fighter;
    const el = this.el;
    const frac = f.health / f.settings.maxHealth;
    el.hp.innerHTML = `<div class="fill" style="width:${Math.round(frac * 100)}%"></div><span>${Math.ceil(f.health)}</span>`;
    el.hp.classList.toggle("low", frac < 0.3);
    const w = f.weapon;
    const ammo =
      f.switching > 0 ? "drawing…" : w.def.magazine > 0 ? (w.reloading > 0 ? "reloading…" : `${w.ammo} / ${w.def.magazine}`) : w.ready ? "ready" : "…";
    el.weapon.innerHTML = `<b>${f.current === "disc" ? "1" : "2"}</b> ${w.def.name}<small>${ammo}</small>`;

    this.hitFlash = Math.max(this.hitFlash - dt * 6, 0);
    el.hit.style.opacity = String(Math.min(this.hitFlash, 1));
    el.hit.classList.toggle("kill", this.hitFlash > 1);
    this.hurtFlash = Math.max(this.hurtFlash - dt * 1.5, 0);
    el.hurt.style.opacity = String(this.hurtFlash * 0.6);

    const now = performance.now();
    el.feed.innerHTML = this.feed.filter((x) => x.until > now).map((x) => `<div>${x.text}</div>`).join("");

    el.dead.hidden = f.alive;
    if (!f.alive) el.dead.innerHTML = `Fragged by <b>${escape(this.killedBy)}</b><small>Back in ${Math.max(Math.ceil(f.respawnIn), 0)}</small>`;

    const m = this.arena.match;
    const ids = [this.me.id, ...this.arena.bots.map((b) => b.id), ...(this.session?.peers.keys() ?? [])];
    const board = m.board(ids);
    const mine = m.kills.get(this.me.id) ?? 0;
    const leader = board[0]!;
    el.matchbar.innerHTML = m.over
      ? `<b>${escape(this.nameOf(m.winner!))}</b> wins · next match in ${Math.max(Math.ceil(this.settings.resultsTime - (this.arena.now() - m.endedAt)), 0)}`
      : `First to ${m.target} · you ${mine}${leader.id !== this.me.id && leader.kills > 0 ? ` · ${escape(this.nameOf(leader.id))} ${leader.kills}` : ""}`;

    el.scores.hidden = !(this.showScores || m.over);
    if (!el.scores.hidden) {
      el.scores.innerHTML =
        `<table><tr><th></th><th>Player</th><th>Kills</th><th>Deaths</th></tr>` +
        board
          .map((r, i) => `<tr${r.id === this.me.id ? ' class="self"' : ""}><td>${i + 1}</td><td style="color:${this.colourOf(r.id)}">${escape(this.nameOf(r.id))}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`)
          .join("") +
        `</table>`;
    }
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
