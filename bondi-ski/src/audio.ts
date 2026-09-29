import { AmbienceBed, AudioEngine, playMelody, type Note } from "@slop/audio";

const n = (pitch: number | null, beats: number): Note => ({ pitch, beats });
/** A short bright fanfare for the finish; the longer ending for a personal best. */
const FINISH: Note[] = [n(72, 0.5), n(76, 0.5), n(79, 1)];
const PERSONAL_BEST: Note[] = [n(72, 0.5), n(76, 0.5), n(79, 0.5), n(84, 1), n(null, 0.25), n(79, 0.5), n(84, 1.5)];

export interface CoastAudioSettings {
  master: number;
  ocean: number;
  wind: number;
}

/**
 * Synthesised sound for the coast: surf breaking on the rocks, wind that rises with
 * your speed, a hiss while you ski, the jetpack's roar, and chimes for gates and the finish.
 */
export class CoastAudio {
  readonly settings: CoastAudioSettings = { master: 0.7, ocean: 0.3, wind: 0.25 };
  private engine: AudioEngine | null = null;
  private ocean: AmbienceBed | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private hissGain: GainNode | null = null;
  private jetGain: GainNode | null = null;

  /** Call from a click: browsers only start audio after a user gesture. */
  unlock(): void {
    if (!this.engine) this.start();
    this.engine!.unlock();
  }

  private start(): void {
    const e = (this.engine = new AudioEngine());
    // Surf: deep rumble with a slow swell and a band of hiss for the white water.
    this.ocean = new AmbienceBed(e, { rumbleHz: 260, rumbleGain: 0.5, murmurHz: 1100, murmurGain: 0.05, humHz: 0, humGain: 0 });
    this.ocean.setLevel(this.settings.ocean, 2);

    const ctx = e.ctx;
    const wind = ctx.createBufferSource();
    wind.buffer = e.noise(3.3);
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(e.sfx);
    wind.start();

    const hiss = ctx.createBufferSource();
    hiss.buffer = e.noise(2.1);
    hiss.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2500;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    hiss.connect(hp).connect(this.hissGain).connect(e.sfx);
    hiss.start();

    const jet = ctx.createBufferSource();
    jet.buffer = e.noise(2.7, "brown");
    jet.loop = true;
    const jlp = ctx.createBiquadFilter();
    jlp.type = "lowpass";
    jlp.frequency.value = 900;
    this.jetGain = ctx.createGain();
    this.jetGain.gain.value = 0;
    jet.connect(jlp).connect(this.jetGain).connect(e.sfx);
    jet.start();
    this.apply();
  }

  /** Sound off: remembered in this browser. */
  get muted(): boolean {
    try {
      return localStorage.getItem("bondi-ski.muted") === "1";
    } catch {
      return this.mutedFallback;
    }
  }

  set muted(v: boolean) {
    this.mutedFallback = v;
    try {
      localStorage.setItem("bondi-ski.muted", v ? "1" : "0");
    } catch {
      // storage unavailable: lasts this visit
    }
    this.apply();
  }

  private mutedFallback = false;

  apply(): void {
    if (!this.engine) return;
    this.engine.master.gain.value = this.muted ? 0 : this.settings.master;
    this.ocean?.setLevel(this.settings.ocean, 0.5);
  }

  /** Each frame: speed (m/s), whether you're skiing on the ground, and whether the jets are on. */
  update(speed: number, skiing: boolean, jetting: boolean): void {
    const e = this.engine;
    if (!e || !this.windGain || !this.windFilter || !this.hissGain || !this.jetGain) return;
    const t = e.ctx.currentTime;
    const w = Math.min(speed / 40, 1);
    // Only really there at speed.
    this.windGain.gain.setTargetAtTime(w * w * w * 0.35 * this.settings.wind, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(250 + w * 900, t, 0.2);
    this.hissGain.gain.setTargetAtTime(skiing ? 0.02 + w * 0.06 : 0, t, 0.06);
    this.jetGain.gain.setTargetAtTime(jetting ? 0.9 : 0, t, 0.05);
  }

  gate(finish: boolean): void {
    const e = this.engine;
    if (!e) return;
    const t = e.ctx.currentTime + 0.01;
    e.tone(e.sfx, finish ? 784 : 988, t, 0.5, 0.18, [[1, 1], [2, 0.3]]);
    e.tone(e.sfx, finish ? 1175 : 1319, t + 0.09, 0.7, 0.14, [[1, 1], [2, 0.3]]);
  }

  finish(personalBest: boolean): void {
    const e = this.engine;
    if (!e) return;
    playMelody(e, e.pa, personalBest ? PERSONAL_BEST : FINISH, 200, e.ctx.currentTime + 0.3, 0.12);
  }

  // ---------------------------------------------------------------- fighting

  /** A shot: `at` is where (null for your own, played up close). */
  shot(weapon: string, at: { x: number; y: number; z: number } | null): void {
    const e = this.engine;
    if (!e) return;
    const ctx = e.ctx;
    const out = at ? this.oneShot(at, 6) : e.sfx;
    const t = ctx.currentTime;
    if (weapon === "disc") {
      // A deep thunk and a rising whine.
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(90, t);
      osc.frequency.exponentialRampToValueAtTime(420, t + 0.25);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1200;
      osc.connect(lp).connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.32);
      this.noiseBurst(out, 0.09, 0.35, 700);
    } else if (weapon === "grenade") {
      // A soft lob.
      this.noiseBurst(out, 0.12, 0.25, 400, "brown");
    } else {
      this.noiseBurst(out, 0.05, 0.22, 3000);
    }
  }

  /** A blast: big for discs, a tick for bullets. */
  blast(at: { x: number; y: number; z: number }, big: boolean): void {
    const e = this.engine;
    if (!e) return;
    const out = this.oneShot(at, big ? 10 : 3);
    if (big) {
      this.noiseBurst(out, 0.7, 0.9, 500, "brown");
      this.noiseBurst(out, 0.15, 0.4, 2500);
    } else {
      this.noiseBurst(out, 0.04, 0.12, 4000);
    }
  }

  /** You hit someone: a bright tick (higher and double for a kill). */
  hitMarker(kill: boolean): void {
    const e = this.engine;
    if (!e) return;
    const t = e.ctx.currentTime + 0.005;
    e.tone(e.sfx, kill ? 1760 : 1320, t, 0.12, 0.12);
    if (kill) e.tone(e.sfx, 2349, t + 0.08, 0.2, 0.12);
  }

  /** You got hurt. */
  hurt(): void {
    const e = this.engine;
    if (!e) return;
    const t = e.ctx.currentTime + 0.005;
    e.tone(e.sfx, 150, t, 0.18, 0.18, [[1, 1], [1.5, 0.5]]);
  }

  private noiseBurst(out: AudioNode, seconds: number, gain: number, cutoff: number, kind: "white" | "brown" = "white"): void {
    const e = this.engine!;
    const ctx = e.ctx;
    const src = ctx.createBufferSource();
    src.buffer = e.noise(0.8, kind);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
    src.connect(f).connect(g).connect(out);
    src.start();
    src.stop(ctx.currentTime + seconds + 0.05);
  }

  /** Put the listener at the camera (for positional sounds). */
  listen(position: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }): void {
    this.engine?.setListener(position, forward, { x: 0, y: 1, z: 0 });
  }

  /** A panner for one short sound, disconnected once it's done. */
  private oneShot(at: { x: number; y: number; z: number }, ref: number): AudioNode {
    const p = this.engine!.panner(at, this.engine!.sfx, ref, 1);
    setTimeout(() => p.disconnect(), 1500);
    return p;
  }

  /** A low double buzz: you went through the wrong gate. */
  missed(): void {
    const e = this.engine;
    if (!e) return;
    const t = e.ctx.currentTime + 0.01;
    e.tone(e.sfx, 196, t, 0.25, 0.2, [[1, 1], [1.5, 0.4]]);
    e.tone(e.sfx, 185, t + 0.18, 0.35, 0.2, [[1, 1], [1.5, 0.4]]);
  }

  splash(): void {
    const e = this.engine;
    if (!e) return;
    const ctx = e.ctx;
    const src = ctx.createBufferSource();
    src.buffer = e.noise(0.8, "brown");
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    src.connect(g).connect(e.sfx);
    src.start();
  }

  landing(weight: number): void {
    const e = this.engine;
    if (!e) return;
    const ctx = e.ctx;
    const src = ctx.createBufferSource();
    src.buffer = e.noise(0.15, "brown");
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(weight, 1) * 0.6, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    src.connect(lp).connect(g).connect(e.sfx);
    src.start();
  }
}
