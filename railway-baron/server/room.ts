import { RULES, agreed, reply } from "../src/shared/rules";
import {
  ANSWER_MAX,
  NOTES_MAX,
  PETS,
  QUESTION_MAX,
  TAUNTS,
  type Asked,
  type ClientFrame,
  type Phase,
  type PetKind,
  type Proposal,
  type Role,
  type RoomView,
  type SecretView,
  type ServerFrame,
} from "../src/shared/wire";
import type { Oracle } from "./oracle";

/** The server's limit on model calls, shared by every room. */
export interface Budget {
  take(): boolean;
  readonly spent: boolean;
}

export interface RoomOptions {
  oracle: Oracle;
  budget: Budget;
  roundMs: number;
  now?: () => number;
}

/** Caps that keep one room from running up the bill. */
export const ROOM_LIMITS = {
  members: 8,
  rounds: 30,
  /** Answers the robot will check per round. */
  validations: 10,
  openProposals: 12,
  proposalsEach: 3,
};

interface Seat {
  id: string;
  token: string;
  name: string;
  role: Role;
  send: ((f: ServerFrame) => void) | null;
}

/** One game: a baron, their rescuers, and the robot between them. */
export class Room {
  readonly seats = new Map<string, Seat>();
  phase: Phase = "lobby";
  private pet: PetKind = "snake";
  private secret: SecretView | null = null;
  private rejected: RoomView["rejected"];
  private thinking = false;
  private proposals: Proposal[] = [];
  private asked: Asked[] = [];
  private used = 0;
  private deadline = 0;
  private outcome: RoomView["outcome"];
  private rounds = 0;
  private validations = 0;
  private nextProposal = 1;
  private nextSeat = 1;
  private lastTaunt = 0;
  /** When the last person left (for clearing out empty rooms). */
  emptySince = 0;
  private readonly now: () => number;

  constructor(
    readonly name: string,
    private readonly o: RoomOptions,
  ) {
    this.now = o.now ?? Date.now;
  }

  get connected(): number {
    let n = 0;
    for (const s of this.seats.values()) if (s.send) n++;
    return n;
  }

  /** Take a seat, or take yours back. Returns its id, or null when the room is full. */
  sit(token: string, name: string, role: Role, send: (f: ServerFrame) => void): string | null {
    for (const s of this.seats.values()) {
      if (s.token !== token) continue;
      s.send = send;
      s.name = name;
      this.update();
      return s.id;
    }
    if (this.seats.size >= ROOM_LIMITS.members) return null;
    const id = `p${this.nextSeat++}`;
    this.seats.set(id, { id, token, name, role, send });
    this.update();
    return id;
  }

  /** A connection closed: the seat stays theirs to come back to. */
  leave(id: string, send: (f: ServerFrame) => void): void {
    const s = this.seats.get(id);
    if (!s || s.send !== send) return;
    s.send = null;
    if (!this.connected) this.emptySince = this.now();
    this.update();
  }

  /** The train arrives on time. */
  tick(): void {
    if (this.phase === "playing" && this.now() >= this.deadline) this.end("lost", "train");
  }

  handle(id: string, f: ClientFrame): void {
    const s = this.seats.get(id);
    if (!s) return;
    const err = (message: string) => s.send?.({ k: "error", message });
    const baron = s.role === "baron";
    switch (f.k) {
      case "pet":
        if (this.phase !== "lobby" || baron || !PETS.includes(f.pet)) return;
        this.pet = f.pet;
        return this.update();
      case "secret": {
        if (!baron || this.phase !== "lobby" || this.thinking) return;
        const answer = clean(f.answer, ANSWER_MAX);
        const notes = clean(f.notes, NOTES_MAX);
        if (!answer) return err("Give the robot an answer.");
        if (this.validations >= ROOM_LIMITS.validations) return err("The robot won't check any more answers this round.");
        if (!this.o.budget.take()) return this.update();
        this.validations++;
        void this.validate(answer, notes);
        return;
      }
      case "start":
        if (!baron || this.phase !== "lobby" || !this.secret || this.thinking) return;
        if (!this.rescuers().length) return err("Wait for someone to rescue their pet.");
        if (this.rounds >= ROOM_LIMITS.rounds) return err("That's all the rounds this room gets. Make a new one!");
        this.rounds++;
        this.phase = "playing";
        this.deadline = this.now() + this.o.roundMs;
        return this.update();
      case "propose": {
        if (baron || this.phase !== "playing") return;
        const text = clean(f.text, QUESTION_MAX);
        if (!text) return;
        if (this.proposals.length >= ROOM_LIMITS.openProposals) return err("That's plenty of questions on the table; back one.");
        if (this.proposals.filter((p) => p.by === id).length >= ROOM_LIMITS.proposalsEach) return err("You've got enough questions waiting.");
        this.proposals.push({ id: this.nextProposal++, text, by: id, backers: [id] });
        return this.pump();
      }
      case "back": {
        const p = this.proposals.find((q) => q.id === f.id);
        if (baron || this.phase !== "playing" || !p) return;
        p.backers = p.backers.filter((b) => b !== id);
        if (f.on) p.backers.push(id);
        return this.pump();
      }
      case "withdraw":
        if (this.phase !== "playing") return;
        this.proposals = this.proposals.filter((p) => !(p.id === f.id && p.by === id));
        return this.update();
      case "taunt":
        if (!baron || !TAUNTS.includes(f.taunt) || this.now() - this.lastTaunt < 1000) return;
        this.lastTaunt = this.now();
        for (const m of this.seats.values()) m.send?.({ k: "taunt", from: id, taunt: f.taunt });
        return;
      case "again":
        if (!baron || (this.phase !== "won" && this.phase !== "lost")) return;
        this.phase = "lobby";
        this.secret = null;
        this.rejected = undefined;
        this.outcome = undefined;
        this.proposals = [];
        this.asked = [];
        this.used = 0;
        this.validations = 0;
        return this.update();
    }
  }

  private rescuers(): Seat[] {
    return [...this.seats.values()].filter((s) => s.role === "rescuer" && s.send);
  }

  private async validate(answer: string, notes: string): Promise<void> {
    this.thinking = true;
    this.rejected = undefined;
    this.update();
    try {
      const v = await this.o.oracle.validate({ answer, notes });
      if (v.category !== "not_valid" && v.p >= RULES.category) {
        this.secret = { answer, notes, category: v.category, brain: v.brain };
      } else {
        this.secret = null;
        this.rejected = { answer, reason: "That's not a person, place or thing the robot can work with.", brain: v.brain };
      }
    } catch {
      this.rejected = { answer, reason: "The robot's circuits fizzled. Try again." };
    }
    this.thinking = false;
    this.update();
  }

  /** Send the first question enough rescuers agree on, if the robot's free. */
  private pump(): void {
    if (this.phase !== "playing" || this.thinking || !this.secret) return this.update();
    const here = new Set(this.rescuers().map((s) => s.id));
    const p = this.proposals.find((q) => agreed(q.backers.filter((b) => here.has(b)).length, here.size));
    if (!p) return this.update();
    if (!this.o.budget.take()) return this.update();
    this.proposals = this.proposals.filter((q) => q !== p);
    void this.ask(p, this.secret);
  }

  private async ask(p: Proposal, secret: SecretView): Promise<void> {
    this.thinking = true;
    this.update();
    let a: Asked;
    try {
      const j = await this.o.oracle.ask(secret, p.text);
      a = { n: 0, text: p.text, by: p.by, reply: reply(j), brain: j.brain };
    } catch {
      a = { n: 0, text: p.text, by: p.by, reply: "error" };
    }
    this.thinking = false;
    // The train may have come while the robot was thinking.
    if (this.phase !== "playing") return this.update();
    if (a.reply !== "refused" && a.reply !== "error") a.n = ++this.used;
    this.asked.push(a);
    if (a.reply === "correct") return this.end("won", "freed");
    if (this.used >= RULES.questions) return this.end("lost", "questions");
    this.pump();
  }

  private end(phase: "won" | "lost", outcome: NonNullable<RoomView["outcome"]>): void {
    this.phase = phase;
    this.outcome = outcome;
    this.proposals = [];
    this.update();
  }

  private update(): void {
    for (const s of this.seats.values()) s.send?.({ k: "state", view: this.view(s) });
  }

  view(s: Seat): RoomView {
    const baron = s.role === "baron";
    const over = this.phase === "won" || this.phase === "lost";
    const open = baron || over;
    return {
      room: this.name,
      you: s.id,
      role: s.role,
      phase: this.phase,
      members: [...this.seats.values()].map((m) => ({ id: m.id, name: m.name, role: m.role, connected: !!m.send })),
      pet: this.pet,
      ready: !!this.secret,
      secret: open && this.secret ? this.secret : undefined,
      rejected: baron ? this.rejected : undefined,
      thinking: this.thinking,
      proposals: this.proposals,
      asked: this.asked.map((a) => (open ? a : { ...a, brain: undefined })),
      questionsLeft: RULES.questions - this.used,
      msLeft: this.phase === "playing" ? Math.max(0, this.deadline - this.now()) : this.phase === "lobby" ? this.o.roundMs : 0,
      roundMs: this.o.roundMs,
      outcome: this.outcome,
      onStrike: this.o.budget.spent,
    };
  }
}

/** One line of plain text, trimmed and capped. */
export function clean(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
