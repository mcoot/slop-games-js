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
  readonly settings: CoastAudioSettings = { master: 0.8, ocean: 0.7, wind: 0.6 };
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
    this.ocean = new AmbienceBed(e, { rumbleHz: 320, rumbleGain: 0.9, murmurHz: 1400, murmurGain: 0.12, humHz: 0, humGain: 0 });
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

  apply(): void {
    if (!this.engine) return;
    this.engine.master.gain.value = this.settings.master;
    this.ocean?.setLevel(this.settings.ocean, 0.5);
  }

  /** Each frame: speed (m/s), whether you're skiing on the ground, and whether the jets are on. */
  update(speed: number, skiing: boolean, jetting: boolean): void {
    const e = this.engine;
    if (!e || !this.windGain || !this.windFilter || !this.hissGain || !this.jetGain) return;
    const t = e.ctx.currentTime;
    const w = Math.min(speed / 40, 1);
    this.windGain.gain.setTargetAtTime(w * w * 0.5 * this.settings.wind, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(300 + w * 1500, t, 0.2);
    this.hissGain.gain.setTargetAtTime(skiing ? 0.04 + w * 0.12 : 0, t, 0.06);
    this.jetGain.gain.setTargetAtTime(jetting ? 1.4 : 0, t, 0.05);
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
