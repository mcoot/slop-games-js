import * as THREE from "three";
import {
  AmbienceBed,
  Announcer,
  AudioEngine,
  DEPARTURE_JINGLE,
  footstepMaterial,
  playFootstep,
  playMelody,
  type FootstepMaterial,
} from "@slop/audio";
import type { NoiseEvent } from "@slop/ai";
import type { StationRound } from "./round/stationRound";
import { destination } from "./round/fares";

export type Zone = "concourse" | "b1" | "platform";

/** Which part of the station a position is in (for ambience and PA volume). */
export function zoneAt(p: { y: number; z: number }): Zone {
  if (p.y < -1) return "b1";
  if (p.z < -45) return "platform";
  return "concourse";
}

/** Footstep material for each level `surface`. */
export const SURFACE_FOOTSTEPS: Record<string, FootstepMaterial> = {
  floor: "tile",
  stairs: "concrete",
  ramp: "concrete",
  steep: "concrete",
  platform: "concrete",
  prop: "wood",
  shop: "wood",
  machine: "metal",
  gate: "metal",
  train: "metal",
  wall: "concrete",
};

export interface Announcement {
  /** Seconds before departure. */
  before: number;
  lines: { lang: string; text: string }[];
  /** Play the departure jingle with it. */
  melody?: boolean;
}

/** What the station says in the run-up to the round's train. */
export function departureAnnouncements(round: Pick<StationRound, "target" | "departureClock">): Announcement[] {
  const t = round.target;
  const dest = destination(t.destination);
  const time = round.departureClock();
  const [hh, mm] = time.split(":");
  return [
    {
      before: 200,
      lines: [
        { lang: "ja-JP", text: `ご案内いたします。${t.track}番線から、${hh}時${mm}分発、${t.name.ja}、${dest.ja}行きが発車いたします。` },
        { lang: "en-US", text: `Attention please. The ${t.name.en} for ${dest.en} will depart from track ${t.track} at ${time}.` },
      ],
    },
    {
      before: 60,
      melody: true,
      lines: [
        { lang: "ja-JP", text: `まもなく、${t.track}番線から、${t.name.ja}、${dest.ja}行きが発車いたします。` },
        { lang: "en-US", text: `The ${t.name.en} bound for ${dest.en} will soon depart from track ${t.track}.` },
      ],
    },
    {
      before: 12,
      lines: [
        { lang: "ja-JP", text: "ドアが閉まります。ご注意ください。" },
        { lang: "en-US", text: "The doors are closing. Please stand clear." },
      ],
    },
  ];
}

/** General announcements between the departure ones. */
const GENERAL: { lang: string; text: string }[][] = [
  [
    { lang: "ja-JP", text: "駆け込み乗車は危険ですので、おやめください。" },
    { lang: "en-US", text: "For your safety, please do not rush onto the train." },
  ],
  [
    { lang: "ja-JP", text: "お忘れ物のないよう、ご注意ください。" },
    { lang: "en-US", text: "Please make sure you have all your belongings." },
  ],
  [
    { lang: "ja-JP", text: "新幹線のきっぷは、きっぷうりばでお買い求めください。" },
    { lang: "en-US", text: "Shinkansen tickets are available from the ticket machines." },
  ],
];

const BEDS = {
  concourse: { rumbleHz: 180, rumbleGain: 0.5, murmurHz: 700, murmurGain: 0.05, humHz: 0, humGain: 0 },
  b1: { rumbleHz: 140, rumbleGain: 0.45, murmurHz: 600, murmurGain: 0.07, humHz: 100, humGain: 0.006 },
  platform: { rumbleHz: 90, rumbleGain: 0.7, murmurHz: 900, murmurGain: 0.03, humHz: 0, humGain: 0 },
};
/** How loud the PA is in each zone. */
const PA_LEVEL: Record<Zone, number> = { platform: 1, concourse: 0.45, b1: 0.25 };

export interface AudioSettings {
  master: number;
  ambience: number;
  announcements: boolean;
}

export const defaultAudio: AudioSettings = { master: 0.8, ambience: 0.5, announcements: true };

/**
 * The station's soundscape: ambience beds that follow you between floors, the PA
 * (announcements and the departure jingle), your footsteps by surface, the chaser's,
 * and the machine and gate sounds.
 */
export class StationAudio {
  readonly engine = new AudioEngine();
  readonly settings: AudioSettings = { ...defaultAudio };
  private readonly beds: Record<Zone, AmbienceBed> | null;
  private readonly announcer: Announcer;
  private zone: Zone = "concourse";
  private said = new Set<number>();
  private nextGeneral = 40;
  private generalIndex = 0;
  private melodyUntil = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly down = new THREE.Vector3(0, -1, 0);

  constructor(private solids: THREE.Mesh[]) {
    this.beds = {
      concourse: new AmbienceBed(this.engine, BEDS.concourse),
      b1: new AmbienceBed(this.engine, BEDS.b1),
      platform: new AmbienceBed(this.engine, BEDS.platform),
    };
    this.announcer = new Announcer(this.engine);
    this.raycaster.far = 3;
    this.apply();
  }

  setLevel(solids: THREE.Mesh[]): void {
    this.solids = solids;
  }

  unlock(): void {
    this.engine.unlock();
  }

  apply(): void {
    this.engine.master.gain.value = this.settings.master;
    this.engine.ambience.gain.value = this.settings.ambience;
  }

  /** A new round: forget which announcements have been made. */
  reset(): void {
    this.said.clear();
    this.nextGeneral = 40;
    this.announcer.cancel();
  }

  /** Per frame: listener, ambience and PA level. */
  update(camera: THREE.Camera, hasRound: boolean): void {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    this.engine.setListener(camera.position, forward, up);
    this.zone = zoneAt(camera.position);
    if (this.beds) for (const z of Object.keys(this.beds) as Zone[]) this.beds[z].setLevel(hasRound && z === this.zone ? 1 : 0);
    this.engine.pa.gain.setTargetAtTime(PA_LEVEL[this.zone], this.engine.ctx.currentTime, 0.4);
  }

  /** Per tick: announcements and the jingle from the round clock. */
  updateRound(round: StationRound): void {
    if (!this.settings.announcements || round.over) return;
    const left = round.settings.departsIn - round.elapsed;
    departureAnnouncements(round).forEach((a, i) => {
      if (left <= a.before && !this.said.has(i)) {
        this.said.add(i);
        this.announcer.say(a.lines);
        if (a.melody) this.jingle(3);
      }
    });
    if (round.elapsed >= this.nextGeneral && left > 75) {
      this.nextGeneral = round.elapsed + 55;
      this.announcer.say(GENERAL[this.generalIndex++ % GENERAL.length]!);
    }
  }

  /** You boarded: the doors are about to close. */
  boarding(): void {
    this.announcer.cancel();
    this.announcer.say([
      { lang: "ja-JP", text: "ドアが閉まります。" },
      { lang: "en-US", text: "The doors are closing." },
    ]);
  }

  /** Sounds for this tick's noise events: your own movement, machines, gates, coins. */
  noises(events: readonly NoiseEvent[]): void {
    for (const e of events) {
      if (e.kind === "footstep" || e.kind === "landing") {
        // Your own feet: louder the more noise the chaser can hear.
        const weight = e.kind === "landing" ? 1.3 : Math.min(1, 0.25 + e.radius / 18);
        playFootstep(this.engine, this.materialAt(e.position), null, weight * 0.5);
        continue;
      }
      this.effect(e);
    }
  }

  /** A chaser footstep (positional). */
  chaserStep(position: THREE.Vector3, weight = 1): void {
    playFootstep(this.engine, this.materialAt(position), position, weight);
  }

  private materialAt(p: { x: number; y: number; z: number }): FootstepMaterial {
    this.raycaster.set(new THREE.Vector3(p.x, p.y + 0.3, p.z), this.down);
    const hit = this.raycaster.intersectObjects(this.solids, false)[0];
    return footstepMaterial(hit?.object.userData.surface as string | undefined, SURFACE_FOOTSTEPS);
  }

  private jingle(times: number): void {
    const ctx = this.engine.ctx;
    let t = Math.max(ctx.currentTime + 0.1, this.melodyUntil);
    for (let i = 0; i < times; i++) t = playMelody(this.engine, this.engine.pa, DEPARTURE_JINGLE, 132, t, 0.1);
    this.melodyUntil = t;
  }

  private effect(e: NoiseEvent): void {
    const eng = this.engine;
    if (!eng.running) return;
    const out = eng.panner(e.position, eng.sfx, 1.5);
    const t = eng.ctx.currentTime;
    switch (e.kind) {
      case "machine-beep":
        return eng.tone(out, 1318.5, t, 0.12, 0.2);
      case "machine-coin":
      case "yen":
        eng.tone(out, 2200, t, 0.08, 0.12);
        return eng.tone(out, 3100, t + 0.05, 0.1, 0.1);
      case "machine-note":
        return this.buzz(out, t, 0.35);
      case "machine-print":
        for (let i = 0; i < 6; i++) this.buzz(out, t + i * 0.12, 0.08, 520);
        return;
      case "machine-change":
        for (let i = 0; i < 5; i++) eng.tone(out, 2300 + Math.random() * 900, t + i * 0.06, 0.12, 0.1);
        return;
      case "gate-beep":
        return eng.tone(out, 1760, t, 0.15, 0.2);
      case "gate-refuse":
        eng.tone(out, 988, t, 0.3, 0.25);
        return eng.tone(out, 784, t + 0.22, 0.4, 0.25);
    }
  }

  private buzz(out: AudioNode, t: number, seconds: number, hz = 180): void {
    const ctx = this.engine.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }
}
