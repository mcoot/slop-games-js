import type { LevelMarker } from "@slop/level-loader";
import type { NoiseBus, Vec3 } from "@slop/ai";
import { DENOMINATIONS, isNote, type Denomination, type Wallet } from "./yen";

export interface YenPickup {
  value: Denomination;
  position: Vec3;
  taken: boolean;
}

/** Collect radius (m, horizontal) and height tolerance. */
const REACH = 0.9;
const REACH_Y = 1.6;

/** Yen lying around the level, from `money_spawn` markers with a `value` property. */
export class YenPickups {
  readonly items: YenPickup[];

  constructor(markers: LevelMarker[]) {
    this.items = markers.map((m) => ({
      value: toDenomination(m.object.userData.value),
      position: m.position,
      taken: false,
    }));
  }

  get total(): number {
    return this.items.reduce((sum, p) => sum + p.value, 0);
  }

  reset(): void {
    for (const p of this.items) p.taken = false;
  }

  /** Pick up anything within reach of the feet. Coins jingle (a little noise). Returns what was collected. */
  update(feet: Vec3, wallet: Wallet, bus: NoiseBus): YenPickup[] {
    const got: YenPickup[] = [];
    for (const p of this.items) {
      if (p.taken) continue;
      if (Math.hypot(p.position.x - feet.x, p.position.z - feet.z) > REACH) continue;
      if (Math.abs(p.position.y - feet.y) > REACH_Y) continue;
      p.taken = true;
      wallet.add(p.value);
      got.push(p);
      bus.emit({ position: { ...p.position }, radius: isNote(p.value) ? 1.5 : 5, kind: "yen" });
    }
    return got;
  }
}

function toDenomination(v: unknown): Denomination {
  const n = Number(v);
  return (DENOMINATIONS as readonly number[]).includes(n) ? (n as Denomination) : 100;
}
