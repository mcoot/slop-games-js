import { connect } from "../net/connect";
import { randomId, type Transport } from "../net/transport";

/**
 * The "Play with friends" box on the title card for deathmatch: your name, creating a
 * room (a `?room=` link), copying the invite, leaving. Hands the connection to whoever
 * runs the room.
 */
export class Lobby {
  room = "";
  reach = "";
  private readonly el = document.querySelector<HTMLElement>("#mp")!;
  private fallbackName = `Skier ${Math.floor(Math.random() * 90 + 10)}`;

  constructor(
    private readonly onJoin: (transport: Transport) => void,
    private readonly onLeave: () => void,
    private readonly status: () => string,
  ) {
    this.bind();
    this.render();
  }

  /** Join the room in the page's link, if there is one. */
  joinFromLink(): void {
    const room = new URLSearchParams(location.search).get("room");
    if (room && /^[a-z0-9]{4,12}$/.test(room)) this.join(room);
  }

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
  }

  get inRoom(): boolean {
    return this.room !== "";
  }

  /** The room's link: it carries the map and game type so everyone ends up in the same game. */
  inviteLink(): string {
    const url = new URL(location.href);
    const keep = new URLSearchParams();
    for (const k of ["map", "teams", "net", "server"]) {
      const v = url.searchParams.get(k);
      if (v !== null) keep.set(k, v);
    }
    keep.set("room", this.room);
    url.search = keep.toString();
    return url.toString();
  }

  /**
   * When we joined this room (ms since the epoch), kept for the tab's life so a reload
   * (changing map) doesn't lose our place as host.
   */
  get since(): number {
    const key = `bondi-ski.since.${this.room}`;
    try {
      const kept = Number(sessionStorage.getItem(key));
      if (kept > 0) return kept;
      const now = Date.now();
      sessionStorage.setItem(key, String(now));
      return now;
    } catch {
      return (this.sinceFallback ||= Date.now());
    }
  }

  private sinceFallback = 0;

  join(room: string): void {
    this.room = room;
    // Deathmatch rooms are separate from race rooms with the same code.
    const { transport, reach } = connect(`dm-${room}`);
    this.reach = reach;
    this.onJoin(transport);
    this.render();
  }

  leave(): void {
    this.onLeave();
    try {
      sessionStorage.removeItem(`bondi-ski.since.${this.room}`);
    } catch {
      // nothing kept
    }
    this.sinceFallback = 0;
    this.room = "";
    const url = new URL(location.href);
    url.searchParams.delete("room");
    history.replaceState(null, "", url);
    this.render();
  }

  render(): void {
    this.el.querySelector<HTMLElement>(".out")!.hidden = this.inRoom;
    this.el.querySelector<HTMLElement>(".in")!.hidden = !this.inRoom;
    if (this.inRoom) this.el.querySelector(".status")!.textContent = this.status();
    this.onRender?.();
  }

  private bind(): void {
    const nameInput = this.el.querySelector<HTMLInputElement>("input[name=name]")!;
    nameInput.value = this.name;
    nameInput.addEventListener("change", () => {
      this.name = nameInput.value.trim().slice(0, 24) || this.fallbackName;
      nameInput.value = this.name;
      this.onRename?.(this.name);
    });
    for (const el of this.el.querySelectorAll("input, button")) el.addEventListener("click", (e) => e.stopPropagation());
    const create = this.el.querySelector<HTMLButtonElement>(".create")!;
    create.textContent = "Create a room";
    create.addEventListener("click", () => {
      this.join(randomId(6));
      const url = new URL(location.href);
      url.searchParams.set("room", this.room);
      history.replaceState(null, "", url);
    });
    this.el.querySelector(".copy")!.addEventListener("click", (e) => {
      void navigator.clipboard?.writeText(this.inviteLink());
      (e.target as HTMLElement).textContent = "Copied";
    });
    this.el.querySelector(".leave")!.addEventListener("click", () => this.leave());
    this.el.querySelector("h2")!.textContent = "Play with friends";
  }

  onRename: ((name: string) => void) | null = null;
  /** After joining, leaving or the room changing. */
  onRender: (() => void) | null = null;
}
