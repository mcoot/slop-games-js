import type { MapDef } from "../maps";
import { TEAMS, type GameType, type TeamId } from "../combat/teams";

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
  gameType: GameType;
  team(): TeamId;
  setTeam(t: TeamId): void;
  teamSizes(): [number, number];
}

/**
 * The deathmatch pre-match screen on the title card: pick a map and free-for-all or teams
 * (the page reloads onto them, keeping any room), your team, and how many practice bots
 * you play with on your own.
 */
export class Prematch {
  private readonly botsEl = document.querySelector<HTMLElement>("#overlay .bots")!;
  private readonly hintEl = document.querySelector<HTMLElement>("#overlay .bots-hint")!;
  private readonly teamsEl = document.querySelector<HTMLElement>("#overlay .teams")!;

  constructor(private readonly o: PrematchOptions) {
    this.buildMaps();
    this.buildGameType();
    this.buildBots();
    this.render();
  }

  private buildGameType(): void {
    const el = document.querySelector<HTMLElement>("#overlay .gametype")!;
    for (const [type, label] of [["ffa", "Free-for-all"], ["teams", "Teams"]] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("aria-pressed", String(type === this.o.gameType));
      b.addEventListener("click", () => {
        if (type === this.o.gameType) return;
        const url = new URL(location.href);
        if (type === "teams") url.searchParams.set("teams", "1");
        else url.searchParams.delete("teams");
        location.href = url.toString();
      });
      el.append(b);
    }
    document.querySelector<HTMLElement>("#overlay .teampick")!.hidden = this.o.gameType !== "teams";
    TEAMS.forEach((t, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.team = String(i);
      b.addEventListener("click", () => {
        this.o.setTeam(i as TeamId);
        this.render();
      });
      this.teamsEl.append(b);
    });
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
    if (this.o.gameType === "teams") {
      const mine = this.o.team();
      const sizes = this.o.teamSizes();
      for (const b of this.teamsEl.querySelectorAll<HTMLButtonElement>("button")) {
        const t = Number(b.dataset.team) as TeamId;
        const pressed = t === mine;
        b.setAttribute("aria-pressed", String(pressed));
        b.textContent = `${TEAMS[t]!.name} · ${sizes[t]}`;
        b.style.background = pressed ? TEAMS[t]!.colour : "";
        b.style.color = pressed ? "#0b2233" : TEAMS[t]!.colour;
      }
    }
    for (const b of this.botsEl.querySelectorAll<HTMLButtonElement>("button")) {
      b.disabled = room;
      b.setAttribute("aria-pressed", String(!room && Number(b.dataset.n) === bots));
    }
    this.hintEl.textContent = room
      ? "No bots in a room: you're playing the people in it."
      : bots === 0
        ? "Just you: ski the map, or make a room below to play friends."
        : this.o.gameType === "teams"
          ? `${bots} practice ${bots === 1 ? "bot" : "bots"}: ${Math.floor(bots / 2)} with you, ${Math.ceil(bots / 2)} against.`
          : `${bots} practice ${bots === 1 ? "bot" : "bots"} while you're on your own.`;
  }
}
