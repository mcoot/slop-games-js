import type { PhysicsWorld } from "@slop/physics";
import { triggersAt, type Level } from "@slop/level-loader";
import type { Interactable } from "@slop/interaction";
import type { NoiseBus, Vec3 } from "@slop/ai";
import { destination, type Ticket } from "./fares";
import { GateLine, type GateEvents } from "./gates";
import { YenPickups, type YenPickup } from "./pickups";
import { TicketMachine, type TicketMachineSettings, defaultTicketMachine } from "./ticketMachine";
import { TrainDoors } from "./train";
import { Wallet } from "./yen";

export type RoundState = "playing" | "boarding" | "won" | "caught" | "missed";

export interface RoundSettings {
  /** Seconds from the start of the round until the train leaves. */
  departsIn: number;
  /** Once you're aboard with a valid ticket, the doors close this many seconds later. */
  boardingDelay: number;
}

export const defaultRound: RoundSettings = { departsIn: 240, boardingDelay: 3 };

/** The train you have to catch this round. */
export interface TargetTrain {
  name: { ja: string; en: string };
  destination: string;
  track: number;
  /** Station clock time the round starts at (minutes since midnight). */
  clockStart: number;
}

export const HIKARI_507: TargetTrain = {
  name: { ja: "ひかり507号", en: "Hikari 507" },
  destination: "kyoto",
  track: 14,
  clockStart: 14 * 60 + 28,
};

export interface Toast {
  text: string;
  ttl: number;
}

const TRAIN_TRIGGER = "train-interior";

/**
 * One round at the station: collect yen, buy the right ticket, get through the
 * gates and be aboard when the doors close. Built from level markers:
 * `money_spawn`, `interact` (with action "ticket_machine"), `gate`, `train_door`,
 * and a `train-interior_col_trigger` volume.
 */
export class StationRound {
  state: RoundState = "playing";
  elapsed = 0;
  readonly wallet = new Wallet();
  ticket: Ticket | null = null;
  readonly pickups: YenPickups;
  readonly gates: GateLine;
  readonly doors: TrainDoors;
  readonly machines: (Interactable & { position: Vec3 })[];
  /** The machine being used, if any. */
  machine: TicketMachine | null = null;
  toasts: Toast[] = [];
  /** Why the round ended, for the end screen. */
  reason = "";
  private doorsCloseAt: number;
  private conductorWarned = false;

  constructor(
    private readonly world: PhysicsWorld,
    private readonly level: Level,
    public settings: RoundSettings = { ...defaultRound },
    readonly target: TargetTrain = HIKARI_507,
    public machineSettings: TicketMachineSettings = { ...defaultTicketMachine },
  ) {
    this.pickups = new YenPickups(level.markers.get("money_spawn") ?? []);
    this.gates = new GateLine(world, level.markers.get("gate") ?? []);
    this.doors = new TrainDoors(world, level.markers.get("train_door") ?? []);
    this.machines = (level.markers.get("interact") ?? [])
      .filter((m) => m.object.userData.action === "ticket_machine")
      .map((m) => ({ id: m.name, position: m.position, prompt: "きっぷを買う  Buy a ticket" }));
    this.doorsCloseAt = settings.departsIn;
  }

  /** Does this level have what a round needs? */
  static supports(level: Level): boolean {
    return (level.markers.get("interact")?.length ?? 0) > 0 && (level.markers.get("train_door")?.length ?? 0) > 0;
  }

  get timeLeft(): number {
    return Math.max(this.doorsCloseAt - this.elapsed, 0);
  }

  get over(): boolean {
    return this.state === "won" || this.state === "caught" || this.state === "missed";
  }

  /** Is this ticket good for the target train? */
  validFor(ticket: Ticket | null): boolean {
    return ticket !== null && ticket.destination === this.target.destination && ticket.passengers >= 1;
  }

  /** Station clock, "14:31:05". */
  clock(): string {
    return formatClock(this.target.clockStart * 60 + this.elapsed);
  }

  departureClock(): string {
    return formatClock(this.target.clockStart * 60 + this.settings.departsIn).slice(0, 5);
  }

  reset(): void {
    this.state = "playing";
    this.elapsed = 0;
    this.wallet.clear();
    this.ticket = null;
    this.machine = null;
    this.toasts = [];
    this.reason = "";
    this.doorsCloseAt = this.settings.departsIn;
    this.conductorWarned = false;
    this.pickups.reset();
    this.gates.reset();
    this.doors.reset();
  }

  dispose(): void {
    this.gates.dispose();
    this.doors.dispose();
  }

  /** Start using a machine. Its sounds are noise at the machine's position. */
  useMachine(at: Vec3, bus: NoiseBus): TicketMachine {
    this.machine = new TicketMachine(
      this.wallet,
      (s) => bus.emit({ position: { ...at }, radius: s.radius, kind: `machine-${s.kind}` }),
      this.machineSettings,
    );
    return this.machine;
  }

  /** Call once per tick (after the player moves). */
  tick(dt: number, player: Vec3, chaser: Vec3 | null, bus: NoiseBus): { collected: YenPickup[]; gates: GateEvents } {
    const none = { collected: [], gates: { opened: [], refused: [] } };
    this.toasts = this.toasts.filter((t) => (t.ttl -= dt) > 0);
    this.doors.update(dt);
    if (this.over) return none;
    this.elapsed += dt;

    // Finished at a machine?
    if (this.machine) {
      this.machine.update(dt);
      if (this.machine.closed) {
        if (this.machine.ticket) {
          this.ticket = this.machine.ticket;
          const d = destination(this.ticket.destination);
          this.toast(`きっぷ購入 Ticket: ${d.en}` + (this.validFor(this.ticket) ? "" : " (wrong destination!)"));
        }
        this.machine = null;
      }
    }

    const collected = this.pickups.update(player, this.wallet, bus);
    for (const p of collected) this.toast(`+¥${p.value.toLocaleString("en-US")}`, 1.2);

    const gates = this.gates.update(dt, player, this.ticket !== null, chaser, bus);
    if (gates.refused.length) this.toast("きっぷをお確かめください  Please check your ticket");

    // Boarding.
    const aboard = triggersAt(this.world, this.level, { x: player.x, y: player.y + 0.9, z: player.z }).includes(TRAIN_TRIGGER);
    if (aboard && this.state === "playing") {
      if (this.validFor(this.ticket)) {
        this.state = "boarding";
        this.doorsCloseAt = Math.min(this.doorsCloseAt, this.elapsed + this.settings.boardingDelay);
        this.toast("ドアが閉まります  Doors closing");
      } else if (!this.conductorWarned) {
        this.conductorWarned = true;
        this.toast("車掌: きっぷを拝見します  Conductor: ticket, please");
      }
    }
    if (!aboard) this.conductorWarned = false;

    if (this.elapsed >= this.doorsCloseAt) {
      this.doors.close();
      if (aboard && this.validFor(this.ticket)) this.end("won", `${this.target.name.en} to ${destination(this.target.destination).en}. You made it.`);
      else if (aboard) this.end("missed", "The conductor put you off: no valid ticket.");
      else this.end("missed", `The ${this.target.name.en} left without you.`);
    }
    return { collected, gates };
  }

  /** The chaser got you. */
  caught(): void {
    if (this.over) return;
    this.machine?.abandon();
    this.machine = null;
    this.end("caught", "The salaryman caught you.");
  }

  toast(text: string, ttl = 2.5): void {
    this.toasts.push({ text, ttl });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  private end(state: RoundState, reason: string): void {
    this.state = state;
    this.reason = reason;
  }
}

function formatClock(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const hh = Math.floor(s / 3600) % 24;
  const mm = Math.floor(s / 60) % 60;
  const ss = s % 60;
  return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
