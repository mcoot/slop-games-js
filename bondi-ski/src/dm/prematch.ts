import type { MapDef } from "../maps";

/** Practice bot counts offered on the pre-match screen (0 is off). */
export const BOT_CHOICES = [0, 1, 2, 3, 4, 6, 8];
const DEFAULT_BOTS = 3;
const BOTS_KEY = "bondi-ski.bots";

/** How many practice bots to start with: `?bots=` in the link, else your last choice. */
export function savedBots(): number {
  let param: string | null = null;
  let stored: string | null = null;
  try {
    param = new URLSearchParams(location.search).get("bots");
    stored = localStorage.getItem(BOTS_KEY);
  } catch {
    // storage unavailable: the default
  }
  const n = Number(param ?? stored ?? DEFAULT_BOTS);
  return Number.isInteger(n) && n >= 0 && n <= 8 ? n : DEFAULT_BOTS;
}

function saveBots(n: number): void {
  try {
    localStorage.setItem(BOTS_KEY, String(n));
  } catch {
    // storage unavailable: it lasts this visit
  }
}

export interface PrematchOptions {
  maps: MapDef[];
  current: MapDef;
  bots(): number;
  setBots(n: number): void;
  /** In a room there are no bots: the other players are the opposition. */
  inRoom(): boolean;
}

/**
 * The deathmatch pre-match screen on the title card: pick a map (the page reloads onto
 * it, keeping any room) and how many practice bots you face on your own.
 */
export class Prematch {
  private readonly botsEl = document.querySelector<HTMLElement>("#overlay .bots")!;
  private readonly hintEl = document.querySelector<HTMLElement>("#overlay .bots-hint")!;

  constructor(private readonly o: PrematchOptions) {
    this.buildMaps();
    this.buildBots();
    this.render();
  }

  private buildMaps(): void {
    const list = document.querySelector<HTMLElement>("#prematch .maplist")!;
    for (const m of this.o.maps) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "map";
      b.setAttribute("aria-pressed", String(m === this.o.current));
      const title = document.createElement("b");
      title.textContent = m.title;
      const blurb = document.createElement("span");
      blurb.textContent = m.blurb;
      b.append(title, blurb);
      b.addEventListener("click", () => {
        if (m === this.o.current) return;
        const url = new URL(location.href);
        url.searchParams.set("map", m.id);
        location.href = url.toString();
      });
      list.append(b);
    }
  }

  private buildBots(): void {
    for (const n of BOT_CHOICES) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.n = String(n);
      b.textContent = n === 0 ? "Off" : String(n);
      b.addEventListener("click", () => {
        this.o.setBots(n);
        saveBots(n);
        // A `?bots=` in the link would override the choice on the next load.
        const url = new URL(location.href);
        if (url.searchParams.has("bots")) {
          url.searchParams.delete("bots");
          history.replaceState(null, "", url);
        }
        this.render();
      });
      this.botsEl.append(b);
    }
  }

  /** Show the current choices (call when joining or leaving a room). */
  render(): void {
    const room = this.o.inRoom();
    const bots = this.o.bots();
    for (const b of this.botsEl.querySelectorAll<HTMLButtonElement>("button")) {
      b.disabled = room;
      b.setAttribute("aria-pressed", String(!room && Number(b.dataset.n) === bots));
    }
    this.hintEl.textContent = room
      ? "No bots in a room: you're playing the people in it."
      : bots === 0
        ? "Just you: ski the map, or make a room below to play friends."
        : `${bots} practice ${bots === 1 ? "bot" : "bots"} while you're on your own.`;
  }
}
