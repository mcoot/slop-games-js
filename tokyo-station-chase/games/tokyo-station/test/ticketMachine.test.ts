import { describe, expect, it } from "vitest";
import { TicketMachine, type MachineSound } from "../src/round/ticketMachine";
import { fare, RESERVED_SURCHARGE } from "../src/round/fares";
import { makeChange, Wallet } from "../src/round/yen";

/** Run the machine's timers until it's no longer busy. */
function settle(m: TicketMachine) {
  for (let i = 0; i < 1000 && m.view().busy; i++) m.update(0.05);
}
function press(m: TicketMachine, id: string) {
  m.press(id);
  settle(m);
}
function buy(m: TicketMachine, dest: string, seat: string, pax: number) {
  press(m, `dest:${dest}`);
  press(m, `seat:${seat}`);
  press(m, `pax:${pax}`);
}

describe("yen", () => {
  it("makes change in as few pieces as possible", () => {
    expect(makeChange(0)).toEqual([]);
    expect(makeChange(1350)).toEqual([1000, 100, 100, 100, 50]);
    expect(makeChange(7777)).toEqual([5000, 1000, 1000, 500, 100, 100, 50, 10, 10, 5, 1, 1]);
  });

  it("keeps real coins and notes in the wallet", () => {
    const w = new Wallet({ 1000: 2, 100: 3 });
    expect(w.total).toBe(2300);
    expect(w.take(1000)).toBe(true);
    expect(w.take(500)).toBe(false);
    expect(w.total).toBe(1300);
  });
});

describe("ticket machine", () => {
  it("sells a ticket for the fare and gives change as coins and notes", () => {
    const wallet = new Wallet({ 10000: 1, 5000: 1 });
    const m = new TicketMachine(wallet);
    buy(m, "kyoto", "unreserved", 1);
    expect(m.screen).toBe("pay");
    expect(m.fare).toBe(12650);
    press(m, "insert:10000");
    expect(m.screen).toBe("pay"); // ¥10,000 isn't enough yet
    press(m, "insert:5000");
    expect(m.screen).toBe("done");
    press(m, "take");
    expect(m.closed).toBe(true);
    expect(m.ticket).toEqual({ destination: "kyoto", seat: "unreserved", passengers: 1, fare: 12650 });
    expect(wallet.total).toBe(15000 - 12650);
    expect([wallet.count(1000), wallet.count(100), wallet.count(50)]).toEqual([2, 3, 1]);
  });

  it("charges more for reserved seats and extra passengers", () => {
    expect(fare("kyoto", "reserved", 1)).toBe(12650 + RESERVED_SURCHARGE);
    expect(fare("kyoto", "unreserved", 2)).toBe(25300);
    const m = new TicketMachine(new Wallet());
    buy(m, "kyoto", "reserved", 2);
    expect(m.fare).toBe((12650 + RESERVED_SURCHARGE) * 2);
  });

  it("refuses ¥1 and ¥5 coins", () => {
    const wallet = new Wallet({ 1: 3, 5: 2, 1000: 1 });
    const m = new TicketMachine(wallet);
    buy(m, "shinagawa", "unreserved", 1);
    const buttons = m.view().buttons;
    expect(buttons.find((b) => b.id === "insert:1")!.disabled).toBe(true);
    press(m, "insert:5");
    expect(m.insertedTotal).toBe(0);
    expect(wallet.total).toBe(1013);
  });

  it("gives back everything inserted when you cancel", () => {
    const wallet = new Wallet({ 1000: 5, 500: 2 });
    const m = new TicketMachine(wallet);
    buy(m, "kyoto", "unreserved", 1);
    press(m, "insert:1000");
    press(m, "insert:500");
    expect(wallet.total).toBe(4500);
    press(m, "cancel");
    expect(m.closed).toBe(true);
    expect(m.ticket).toBeNull();
    expect(wallet.total).toBe(6000);
    expect(wallet.count(500)).toBe(2);
  });

  it("goes back a screen, and takes time doing everything", () => {
    const m = new TicketMachine(new Wallet({ 1000: 1 }));
    m.press("dest:nagoya");
    expect(m.view().busy).toBe(true);
    m.press("dest:kyoto"); // ignored while busy
    settle(m);
    expect(m.destinationId).toBe("nagoya");
    press(m, "back");
    expect(m.screen).toBe("destination");
  });

  it("makes noise: beeps, coins and a loud printer", () => {
    const sounds: MachineSound[] = [];
    const m = new TicketMachine(new Wallet({ 1000: 1 }), (s) => sounds.push(s));
    buy(m, "shinagawa", "unreserved", 1);
    press(m, "insert:1000");
    expect(sounds.map((s) => s.kind)).toEqual(["beep", "beep", "beep", "note", "print", "change"]);
    expect(Math.max(...sounds.map((s) => s.radius))).toBeGreaterThanOrEqual(12);
  });
});
