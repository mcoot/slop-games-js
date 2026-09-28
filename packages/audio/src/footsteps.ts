import type { AudioEngine, Vec3 } from "./index";

/** What a footstep sounds like. */
export type FootstepMaterial = "tile" | "concrete" | "metal" | "wood" | "rubber";

export interface FootstepProfile {
  /** Noise burst filter band (Hz). */
  lowpass: number;
  highpass: number;
  /** Seconds for the burst to die away. */
  decay: number;
  /** Resonant ring (Hz) for hollow or metal surfaces, or 0. */
  ring: number;
  gain: number;
}

export const FOOTSTEP_PROFILES: Record<FootstepMaterial, FootstepProfile> = {
  tile: { lowpass: 5200, highpass: 900, decay: 0.07, ring: 0, gain: 0.55 },
  concrete: { lowpass: 2600, highpass: 250, decay: 0.09, ring: 0, gain: 0.6 },
  metal: { lowpass: 6500, highpass: 600, decay: 0.16, ring: 740, gain: 0.5 },
  wood: { lowpass: 1800, highpass: 180, decay: 0.12, ring: 210, gain: 0.6 },
  rubber: { lowpass: 1200, highpass: 120, decay: 0.06, ring: 0, gain: 0.45 },
};

/** Pick a footstep material for a level `surface`, from a game-supplied table. */
export function footstepMaterial(
  surface: string | undefined,
  table: Record<string, FootstepMaterial>,
  fallback: FootstepMaterial = "concrete",
): FootstepMaterial {
  return (surface && table[surface]) || fallback;
}

/**
 * Play one footstep. `position` null means "at the listener" (your own feet); otherwise
 * it's positional. `weight` scales loudness (running ~1, walking ~0.4).
 */
export function playFootstep(engine: AudioEngine, material: FootstepMaterial, position: Vec3 | null, weight = 1): void {
  if (!engine.running) return;
  const ctx = engine.ctx;
  const p = FOOTSTEP_PROFILES[material];
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = engine.noise(0.25);
  src.playbackRate.value = 0.85 + Math.random() * 0.3;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = p.highpass;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = p.lowpass * (0.9 + Math.random() * 0.2);
  const g = ctx.createGain();
  const peak = p.gain * weight;
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);
  const out = position ? engine.panner(position, engine.sfx, 2.5) : engine.sfx;
  src.connect(hp).connect(lp).connect(g).connect(out);
  src.start(t, Math.random() * 0.1, p.decay + 0.05);
  if (p.ring > 0) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = p.ring * (0.95 + Math.random() * 0.1);
    bp.Q.value = 18;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(peak * 1.5, t);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + p.decay * 2);
    src.connect(bp).connect(rg).connect(out);
  }
}
