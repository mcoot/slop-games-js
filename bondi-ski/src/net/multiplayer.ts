import type * as THREE from "three";
import { formatTime } from "../race/race";
import { RacerView } from "../view/racer";
import { connect } from "./connect";
import { RaceSession, type SessionEvents, type Standing } from "./session";
import { randomId } from "./transport";

/**
 * Racing friends: the room from the page's `?room=` link, other racers drawn in the
 * world, the countdown, live standings and the lobby controls on the title card.
 */
export class Multiplayer {
  session: RaceSession | null = null;
  room = "";
  private reach = "";
  private readonly views = new Map<string, RacerView>();
  private readonly lobby = document.querySelector<HTMLElement>("#mp")!;
  private readonly standingsEl = document.querySelector<HTMLElement>("#standings")!;
  private readonly countdownEl = document.querySelector<HTMLElement>("#countdown")!;
  private lastBoard = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly standHeight: number,
    private readonly progressOf: (x: number, z: number) => number,
    private readonly events: Omit<SessionEvents, "peersChanged">,
    /** Off in deathmatch, which runs its own rooms. */
    active = true,
  ) {
    if (!active) return;
    const room = new URLSearchParams(location.search).get("room");
    if (room && /^[a-z0-9]{4,12}$/.test(room)) this.join(room);
    this.bindLobby();
    this.renderLobby();
  }

  private fallbackName = defaultName();

  get name(): string {
    try {
      return localStorage.getItem("bondi-ski.name") || this.fallbackName;
    } catch {
      return this.fallbackName;
    }
  }

  set name(v: string) {
    try {
      localStorage.setItem("bondi-ski.name", v);
    } catch {
      // storage unavailable: the name lasts this visit
    }
    this.fallbackName = v;
    this.session?.setName(v);
  }

  /** In a race countdown: hold everyone on the line. */
  get frozen(): boolean {
    return this.session?.phase === "countdown";
  }

  /** In a multiplayer race right now (the countdown included). */
  get racing(): boolean {
    const p = this.session?.phase;
    return p === "countdown" || p === "racing" || p === "done";
  }

  create(): void {
    this.join(randomId(6));
    const url = new URL(location.href);
    url.searchParams.set("room", this.room);
    history.replaceState(null, "", url);
  }

  join(room: string): void {
    this.leave();
    this.room = room;
    const { transport, reach } = connect(`race-${room}`);
    this.reach = reach;
    this.session = new RaceSession(
      transport,
      this.name,
      { ...this.events, peersChanged: () => this.syncViews() },
      this.progressOf,
    );
    this.renderLobby();
  }

  leave(): void {
    this.session?.leave();
    this.session = null;
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
  }

  inviteLink(): string {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("room", this.room);
    return url.toString();
  }

  tick(me: { x: number; y: number; z: number; yaw: number; time: number; next: number }): void {
    this.session?.tick(me);
  }

  /** Each frame: move other racers, the countdown, the standings. */
  render(me: { x: number; z: number; next: number }): void {
    const s = this.session;
    this.countdownEl.hidden = !this.frozen;
    if (s && this.frozen) this.countdownEl.textContent = String(Math.ceil(s.countdownLeft));
    if (!s) {
      this.standingsEl.hidden = true;
      return;
    }
    for (const [id, view] of this.views) {
      const peer = s.peers.get(id);
      const p = peer && s.sample(peer);
      view.visible = !!p;
      if (p) view.update(p.x, p.y, p.z, p.yaw);
    }
    const now = performance.now();
    if (now - this.lastBoard > 200) {
      this.lastBoard = now;
      this.renderStandings(s.standings(me));
    }
  }

  /** Results so far, for the finish card. */
  resultsHtml(me: { x: number; z: number; next: number }): string {
    if (!this.session || !this.racing) return "";
    return this.session
      .standings(me)
      .map((r, i) => `<tr${r.self ? ' class="self"' : ""}><td>${r.inRace ? i + 1 : ""}</td><td style="color:${r.colour}">${escape(r.name)}</td><td>${!r.inRace ? "left" : r.finish !== null ? formatTime(r.finish) : "racing…"}</td></tr>`)
      .join("");
  }

  private renderStandings(list: Standing[]): void {
    this.standingsEl.hidden = false;
    const between = !this.racing || this.session?.phase === "done";
    const head = `<div class="room">Room ${this.room} · ${list.length} here${between ? " · Enter to race" : ""}</div>`;
    const rows = list
      .map((r, i) => {
        const status = !r.inRace ? "left" : r.finish !== null ? formatTime(r.finish) : this.racing ? `gate ${r.gates}` : "";
        return `<div class="row${r.self ? " self" : ""}${r.inRace ? "" : " out"}"><span class="pos">${this.racing && r.inRace ? i + 1 : "·"}</span><span class="name" style="color:${r.colour}">${escape(r.name)}</span><span class="status">${status}</span></div>`;
      })
      .join("");
    this.standingsEl.innerHTML = head + (list.length > 1 || this.racing ? rows : `<div class="hint">Share the link to race: ${escape(this.inviteLink())}</div>`);
  }

  private syncViews(): void {
    const s = this.session;
    if (!s) return;
    for (const [id, view] of this.views) {
      if (!s.peers.has(id)) {
        view.dispose();
        this.views.delete(id);
      }
    }
    for (const peer of s.peers.values()) {
      let view = this.views.get(peer.id);
      if (!view) {
        view = new RacerView(peer.colour, this.standHeight, peer.name);
        view.addTo(this.scene);
        this.views.set(peer.id, view);
      } else {
        view.setName(peer.name, peer.colour, this.standHeight);
      }
    }
    this.renderLobby();
  }

  private bindLobby(): void {
    const nameInput = this.lobby.querySelector<HTMLInputElement>("input[name=name]")!;
    nameInput.value = this.name;
    nameInput.addEventListener("change", () => {
      this.name = nameInput.value.trim().slice(0, 24) || defaultName();
      nameInput.value = this.name;
    });
    // Typing a name shouldn't start the game.
    for (const el of this.lobby.querySelectorAll("input, button")) el.addEventListener("click", (e) => e.stopPropagation());
    this.lobby.querySelector(".create")!.addEventListener("click", () => this.create());
    this.lobby.querySelector(".copy")!.addEventListener("click", (e) => {
      void navigator.clipboard?.writeText(this.inviteLink());
      (e.target as HTMLElement).textContent = "Copied";
    });
    this.lobby.querySelector(".leave")!.addEventListener("click", () => {
      this.leave();
      this.room = "";
      const url = new URL(location.href);
      url.searchParams.delete("room");
      history.replaceState(null, "", url);
      this.renderLobby();
    });
  }

  private renderLobby(): void {
    const inRoom = !!this.session;
    this.lobby.querySelector<HTMLElement>(".out")!.hidden = inRoom;
    this.lobby.querySelector<HTMLElement>(".in")!.hidden = !inRoom;
    if (inRoom) {
      const n = (this.session?.peers.size ?? 0) + 1;
      this.lobby.querySelector(".status")!.textContent =
        `Room ${this.room} · ${n} ${n === 1 ? "skier" : "skiers"} here · connects ${this.reach === "internet" ? "over the internet" : "tabs on this computer only"}. Press Enter in game to start a race.`;
    }
  }
}

function defaultName(): string {
  return `Skier ${Math.floor(Math.random() * 90 + 10)}`;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
