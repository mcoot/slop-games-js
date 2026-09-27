import type { ScreenButton, ScreenMachine, ScreenView } from "@slop/ui-screens";
import { DESTINATIONS, SEATS, destination, fare, type SeatType, type Ticket } from "./fares";
import { DENOMINATIONS, formatYen, isNote, makeChange, type Denomination, type Wallet } from "./yen";

export type MachineScreen = "destination" | "seat" | "passengers" | "pay" | "issuing" | "done";

/** A sound the machine makes, which the chaser can hear (radius in metres). */
export interface MachineSound {
  kind: "beep" | "coin" | "note" | "print" | "change";
  radius: number;
}

export interface TicketMachineSettings {
  /** Seconds each screen change takes ("please wait"). */
  screenDelay: number;
  /** Seconds to print the ticket. */
  issueTime: number;
  /** Seconds to accept each note (coins are instant). */
  noteDelay: number;
}

export const defaultTicketMachine: TicketMachineSettings = { screenDelay: 0.35, issueTime: 2.2, noteDelay: 0.6 };

/** Real machines don't take ¥1 or ¥5 coins. */
const NOT_ACCEPTED: ReadonlySet<Denomination> = new Set([1, 5]);
const MAX_PASSENGERS = 4;

/**
 * A Tōkaidō Shinkansen ticket machine (JR Central style), as a screen state machine:
 * destination → seat type → passengers → pay with cash → ticket and change.
 *
 * Money moves for real: inserted pieces leave the wallet, cancelling returns them,
 * and change comes back as coins and notes. Every button press, coin and printout
 * makes a sound the game turns into noise.
 */
export class TicketMachine implements ScreenMachine {
  screen: MachineScreen = "destination";
  /** Set when the customer walks away (cancelled, or took their ticket). */
  closed = false;
  /** The ticket, once taken. */
  ticket: Ticket | null = null;
  destinationId: string | null = null;
  seat: SeatType = "unreserved";
  passengers = 1;
  private inserted: Denomination[] = [];
  private change: Denomination[] = [];
  private busy = 0;
  private afterBusy: (() => void) | null = null;

  constructor(
    private readonly wallet: Wallet,
    private readonly sound: (s: MachineSound) => void = () => {},
    public settings: TicketMachineSettings = { ...defaultTicketMachine },
  ) {}

  get fare(): number {
    return this.destinationId ? fare(this.destinationId, this.seat, this.passengers) : 0;
  }

  get insertedTotal(): number {
    return this.inserted.reduce((a, b) => a + b, 0);
  }

  update(dt: number): void {
    if (this.busy <= 0) return;
    this.busy -= dt;
    if (this.busy <= 0) {
      const next = this.afterBusy;
      this.afterBusy = null;
      next?.();
    }
  }

  press(id: string): void {
    if (this.closed || this.busy > 0) return;
    const [action, arg] = id.split(":");
    if (action === "cancel") return this.cancel();
    if (action === "back") return this.back();
    switch (this.screen) {
      case "destination":
        if (action === "dest" && arg) {
          this.destinationId = arg;
          this.go("seat");
        }
        break;
      case "seat":
        if (action === "seat" && (arg === "unreserved" || arg === "reserved")) {
          this.seat = arg;
          this.go("passengers");
        }
        break;
      case "passengers":
        if (action === "pax" && arg) {
          this.passengers = Number(arg);
          this.go("pay");
        }
        break;
      case "pay":
        if (action === "insert" && arg) this.insert(Number(arg) as Denomination);
        break;
      case "done":
        if (action === "take") {
          this.wallet.addAll(this.change);
          this.change = [];
          this.closed = true;
        }
        break;
    }
  }

  view(): ScreenView {
    const cancel: ScreenButton = { id: "cancel", label: "取消", sublabel: "Cancel", kind: "cancel" };
    const back: ScreenButton = { id: "back", label: "戻る", sublabel: "Back" };
    const busy = this.busy > 0;
    const wait = busy ? "しばらくお待ちください  Please wait" : undefined;
    const trip = () => {
      const d = destination(this.destinationId!);
      return `東京 → ${d.ja}  Tokyo → ${d.en}`;
    };
    switch (this.screen) {
      case "destination":
        return {
          screen: "destination",
          title: "行き先を選んでください",
          subtitle: "Select your destination · 新幹線 Shinkansen",
          buttons: DESTINATIONS.map((d) => ({
            id: `dest:${d.id}`,
            label: `${d.ja}  ${d.en}`,
            sublabel: `自由席 ${formatYen(d.unreserved)}`,
          })),
          footer: [cancel],
          status: wait,
          busy,
        };
      case "seat":
        return {
          screen: "seat",
          title: "座席の種類を選んでください",
          subtitle: `Select seat type · ${trip()}`,
          buttons: (Object.keys(SEATS) as SeatType[]).map((s) => ({
            id: `seat:${s}`,
            label: `${SEATS[s].ja}  ${SEATS[s].en}`,
            sublabel: formatYen(fare(this.destinationId!, s, 1)),
          })),
          footer: [back, cancel],
          status: wait,
          busy,
        };
      case "passengers":
        return {
          screen: "passengers",
          title: "人数を選んでください",
          subtitle: `Number of passengers (adults) · ${trip()} · ${SEATS[this.seat].en}`,
          buttons: Array.from({ length: MAX_PASSENGERS }, (_, i) => ({
            id: `pax:${i + 1}`,
            label: `おとな ${i + 1}名  Adult ×${i + 1}`,
            sublabel: formatYen(fare(this.destinationId!, this.seat, i + 1)),
          })),
          footer: [back, cancel],
          status: wait,
          busy,
        };
      case "pay":
        return {
          screen: "pay",
          title: "お金を入れてください",
          subtitle: "Please insert money",
          lines: [
            `${trip()} · ${SEATS[this.seat].ja} ${SEATS[this.seat].en} · おとな${this.passengers}名`,
            `運賃 Fare  ${formatYen(this.fare)}`,
            `投入金額 Inserted  ${formatYen(this.insertedTotal)}`,
            `残り Remaining  ${formatYen(Math.max(this.fare - this.insertedTotal, 0))}`,
          ],
          buttons: [...DENOMINATIONS].reverse().map((d) => ({
            id: `insert:${d}`,
            label: formatYen(d),
            sublabel: NOT_ACCEPTED.has(d) ? "使用不可 Not accepted" : `×${this.wallet.count(d)}`,
            disabled: NOT_ACCEPTED.has(d) || this.wallet.count(d) === 0,
          })),
          footer: [cancel],
          status: wait,
          busy,
        };
      case "issuing":
        return {
          screen: "issuing",
          title: "発券中です",
          subtitle: "Issuing your ticket",
          lines: [trip()],
          buttons: [],
          status: "しばらくお待ちください  Please wait",
          busy: true,
        };
      case "done": {
        const changeTotal = this.change.reduce((a, b) => a + b, 0);
        return {
          screen: "done",
          title: "きっぷとおつりをお取りください",
          subtitle: "Please take your ticket and change",
          lines: [
            `${trip()} · ${SEATS[this.seat].ja} ${SEATS[this.seat].en} · おとな${this.passengers}名`,
            `おつり Change  ${formatYen(changeTotal)}`,
          ],
          buttons: [{ id: "take", label: "受け取る", sublabel: "Take ticket and change", kind: "primary" }],
        };
      }
    }
  }

  private insert(d: Denomination): void {
    if (NOT_ACCEPTED.has(d) || !this.wallet.take(d)) return;
    this.inserted.push(d);
    this.sound({ kind: isNote(d) ? "note" : "coin", radius: isNote(d) ? 5 : 6 });
    const paid = () => {
      if (this.insertedTotal < this.fare) return;
      this.change = makeChange(this.insertedTotal - this.fare);
      this.ticket = { destination: this.destinationId!, seat: this.seat, passengers: this.passengers, fare: this.fare };
      this.inserted = [];
      this.screen = "issuing";
      this.sound({ kind: "print", radius: 10 });
      this.wait(this.settings.issueTime, () => {
        this.screen = "done";
        if (this.change.length) this.sound({ kind: "change", radius: 7 });
      });
    };
    if (isNote(d)) this.wait(this.settings.noteDelay, paid);
    else paid();
  }

  private go(screen: MachineScreen): void {
    this.sound({ kind: "beep", radius: 7 });
    this.wait(this.settings.screenDelay, () => (this.screen = screen));
  }

  private back(): void {
    const prev: Partial<Record<MachineScreen, MachineScreen>> = { seat: "destination", passengers: "seat" };
    const to = prev[this.screen];
    if (to) this.go(to);
  }

  /** Walk away. Anything inserted comes back; a finished ticket is taken with its change. */
  private cancel(): void {
    if (this.screen === "issuing") return;
    if (this.screen === "done") return this.press("take");
    this.wallet.addAll(this.inserted);
    this.inserted = [];
    this.sound({ kind: "beep", radius: 7 });
    this.ticket = null;
    this.closed = true;
  }

  /** Walked away mid-purchase (e.g. caught): return inserted money. */
  abandon(): void {
    if (!this.closed) this.cancel();
  }

  private wait(seconds: number, then: () => void): void {
    if (seconds <= 0) return then();
    this.busy = seconds;
    this.afterBusy = then;
  }
}
