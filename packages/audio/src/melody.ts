import type { AudioEngine } from "./index";

/** A note: MIDI pitch (or null for a rest) and length in beats. */
export interface Note {
  pitch: number | null;
  beats: number;
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function melodyDuration(notes: Note[], bpm: number): number {
  return (notes.reduce((sum, n) => sum + n.beats, 0) * 60) / bpm;
}

/**
 * An original departure jingle (not any railway's real melody): a bright rising
 * phrase answered by a falling one, ending on the tonic. Loop it until the doors close.
 */
export const DEPARTURE_JINGLE: Note[] = [
  { pitch: 76, beats: 0.5 },
  { pitch: 79, beats: 0.5 },
  { pitch: 84, beats: 1 },
  { pitch: 83, beats: 0.5 },
  { pitch: 79, beats: 0.5 },
  { pitch: 81, beats: 1 },
  { pitch: 76, beats: 0.5 },
  { pitch: 77, beats: 0.5 },
  { pitch: 79, beats: 1 },
  { pitch: 74, beats: 0.5 },
  { pitch: 76, beats: 0.5 },
  { pitch: 72, beats: 1.5 },
  { pitch: null, beats: 0.5 },
];

/** Glockenspiel-ish: a fundamental with a couple of inharmonic partials. */
const BELL: [number, number][] = [
  [1, 1],
  [2.76, 0.25],
  [5.4, 0.08],
];

/** Schedule a melody on `out`, starting at audio time `when`. Returns when it ends. */
export function playMelody(engine: AudioEngine, out: AudioNode, notes: Note[], bpm: number, when: number, gain = 0.15): number {
  let t = when;
  const beat = 60 / bpm;
  for (const n of notes) {
    if (n.pitch !== null) engine.tone(out, midiToHz(n.pitch), t, Math.max(0.6, n.beats * beat * 2.2), gain, BELL);
    t += n.beats * beat;
  }
  return t;
}
