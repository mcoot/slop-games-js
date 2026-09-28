/**
 * Game audio on the Web Audio API, with everything synthesised (no sample files):
 * an engine with a positional listener, one-shot positional sounds, looping ambience
 * beds that crossfade, surface-aware footsteps, melodies, and announcements.
 *
 * Browsers only start audio after a user gesture: call `unlock()` from a click.
 */
export * from "./footsteps";
export * from "./melody";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  /** Everything goes through here. */
  readonly master: GainNode;
  /** Sound effects (footsteps, machines). */
  readonly sfx: GainNode;
  /** Ambience beds. */
  readonly ambience: GainNode;
  /** Announcements and melodies. */
  readonly pa: GainNode;
  private readonly noiseCache = new Map<string, AudioBuffer>();

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfx = this.bus();
    this.ambience = this.bus();
    this.pa = this.bus();
  }

  get running(): boolean {
    return this.ctx.state === "running";
  }

  unlock(): void {
    void this.ctx.resume();
  }

  /** Put the listener at the camera. `forward` and `up` are unit vectors. */
  setListener(position: Vec3, forward: Vec3, up: Vec3): void {
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(position.x, t, 0.02);
      l.positionY.setTargetAtTime(position.y, t, 0.02);
      l.positionZ.setTargetAtTime(position.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      l.setPosition(position.x, position.y, position.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /** A panner at `position` feeding `bus`. Sounds `refDistance` away play at full volume. */
  panner(position: Vec3, bus: AudioNode = this.sfx, refDistance = 2, rolloff = 1.2): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = refDistance;
    p.rolloffFactor = rolloff;
    p.maxDistance = 200;
    p.positionX.value = position.x;
    p.positionY.value = position.y;
    p.positionZ.value = position.z;
    p.connect(bus);
    return p;
  }

  /** White noise, cached by length. */
  noise(seconds: number, kind: "white" | "brown" = "white"): AudioBuffer {
    const key = `${kind}:${seconds}`;
    let buf = this.noiseCache.get(key);
    if (!buf) {
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
      buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === "brown") {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        } else {
          d[i] = w;
        }
      }
      this.noiseCache.set(key, buf);
    }
    return buf;
  }

  /** A short tone with an exponential decay (bell/marimba-like with `partials`). */
  tone(out: AudioNode, freq: number, when: number, duration: number, gain: number, partials: [number, number][] = [[1, 1]]): void {
    for (const [ratio, amp] of partials) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * ratio;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(gain * amp, when + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, when + duration / ratio ** 0.5);
      osc.connect(g).connect(out);
      osc.start(when);
      osc.stop(when + duration + 0.05);
    }
  }

  private bus(): GainNode {
    const g = this.ctx.createGain();
    g.connect(this.master);
    return g;
  }
}

/**
 * A looping bed of filtered noise and hum, e.g. a concourse or a platform. Several
 * beds can play at once; `setLevel` crossfades them.
 */
export interface AmbienceRecipe {
  /** Low rumble: brown noise through a low-pass at this frequency. */
  rumbleHz: number;
  rumbleGain: number;
  /** Crowd murmur: band-passed noise around this frequency, slowly swelling. */
  murmurHz: number;
  murmurGain: number;
  /** Electrical/ventilation hum (Hz), or 0. */
  humHz: number;
  humGain: number;
}

export class AmbienceBed {
  private readonly out: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];

  constructor(
    private readonly engine: AudioEngine,
    recipe: AmbienceRecipe,
  ) {
    const ctx = engine.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(engine.ambience);

    const rumble = ctx.createBufferSource();
    rumble.buffer = engine.noise(4, "brown");
    rumble.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = recipe.rumbleHz;
    const rg = ctx.createGain();
    rg.gain.value = recipe.rumbleGain;
    rumble.connect(lp).connect(rg).connect(this.out);
    this.sources.push(rumble);

    const murmur = ctx.createBufferSource();
    murmur.buffer = engine.noise(3.7);
    murmur.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = recipe.murmurHz;
    bp.Q.value = 0.8;
    const mg = ctx.createGain();
    mg.gain.value = recipe.murmurGain;
    // Slow swell, like people coming and going.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = recipe.murmurGain * 0.5;
    lfo.connect(lfoGain).connect(mg.gain);
    murmur.connect(bp).connect(mg).connect(this.out);
    this.sources.push(murmur, lfo);

    if (recipe.humHz > 0) {
      const hum = ctx.createOscillator();
      hum.type = "triangle";
      hum.frequency.value = recipe.humHz;
      const hg = ctx.createGain();
      hg.gain.value = recipe.humGain;
      hum.connect(hg).connect(this.out);
      this.sources.push(hum);
    }
    for (const s of this.sources) s.start();
  }

  /** Fade to `level` (0..1) over `seconds`. */
  setLevel(level: number, seconds = 1.5): void {
    this.out.gain.setTargetAtTime(level, this.engine.ctx.currentTime, seconds / 3);
  }

  stop(): void {
    for (const s of this.sources) s.stop();
    this.out.disconnect();
  }
}

/**
 * Spoken announcements through the browser's speech synthesis (no positional audio),
 * preceded by a chime. Queues: a new announcement waits for the current one.
 */
export class Announcer {
  private queue: { lang: string; text: string }[][] = [];
  private speaking = false;

  constructor(
    private readonly engine: AudioEngine,
    /** 0..1. */
    public volume = 0.9,
  ) {}

  get available(): boolean {
    return typeof speechSynthesis !== "undefined";
  }

  /** Say each line in order, e.g. Japanese then English. */
  say(lines: { lang: string; text: string }[]): void {
    this.queue.push(lines);
    if (!this.speaking) this.next();
  }

  cancel(): void {
    this.queue = [];
    if (this.available) speechSynthesis.cancel();
    this.speaking = false;
  }

  private next(): void {
    const lines = this.queue.shift();
    if (!lines) {
      this.speaking = false;
      return;
    }
    this.speaking = true;
    // PA chime: two notes up.
    const t = this.engine.ctx.currentTime + 0.05;
    this.engine.tone(this.engine.pa, 659.25, t, 0.9, 0.12, [[1, 1], [2, 0.3]]);
    this.engine.tone(this.engine.pa, 880, t + 0.35, 1.2, 0.12, [[1, 1], [2, 0.3]]);
    if (!this.available) {
      setTimeout(() => this.next(), 1500);
      return;
    }
    const voices = speechSynthesis.getVoices();
    lines.forEach((line, i) => {
      const u = new SpeechSynthesisUtterance(line.text);
      u.lang = line.lang;
      u.volume = this.volume;
      u.rate = line.lang.startsWith("ja") ? 1.05 : 1;
      const voice = voices.find((v) => v.lang.replace("_", "-").startsWith(line.lang));
      if (voice) u.voice = voice;
      if (i === lines.length - 1) u.onend = u.onerror = () => this.next();
      setTimeout(() => speechSynthesis.speak(u), i === 0 ? 1300 : 0);
    });
  }
}
