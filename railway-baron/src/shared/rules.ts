import type { Reply } from "./wire";

/** The game's numbers, in one place to tune after playing. */
export const RULES = {
  questions: 20,
  /** How long the train takes to arrive. */
  roundMs: 8 * 60_000,
  /** The robot's `answer` probability at or above this is yes, at or below `no` is no, between is unsure. */
  yes: 0.65,
  no: 0.35,
  /** Below this, the robot won't take it as a yes/no question (and it doesn't count). */
  yesNo: 0.5,
  /** At or above this, a question is a guess at the answer. */
  guess: 0.5,
  /** And at or above this, the guess is right. */
  guessRight: 0.5,
  /** The answer's category needs at least this probability to be accepted. */
  category: 0.5,
};

/** What the robot's probabilities come to. */
export interface Judgement {
  yes: number;
  isYesNo: number;
  isGuess: number;
  guessCorrect: number;
}

/**
 * What the robot says. `named` is whether the question's own words name the answer
 * (`namesAnswer`): the model alone can't free the pet, so a question that only
 * describes the answer ("Is it a celebrity?" for Ryan Gosling) is answered like any
 * other question even when the model takes it for a right guess.
 */
export function reply(j: Judgement, named: boolean, rules = RULES): Reply {
  if (j.isYesNo < rules.yesNo) return "refused";
  if (j.isGuess >= rules.guess) {
    if (j.guessCorrect < rules.guessRight) return "wrong";
    if (named) return "correct";
  }
  if (j.yes >= rules.yes) return "yes";
  if (j.yes <= rules.no) return "no";
  return "unsure";
}

/** More than half the rescuers back it (so a lone rescuer's question goes straight away). */
export function agreed(backers: number, rescuers: number): boolean {
  return backers * 2 > rescuers;
}

/** Little words that don't make a guess: "the", "of", titles. */
const FILLER = new Set(["a", "an", "the", "of", "and", "in", "on", "at", "to", "for", "de", "la", "le", "von", "van", "mr", "mrs", "ms", "dr", "sir", "st", "it", "is", "this"]);

const words = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

/**
 * Does the question name the answer, in so many words? True when it shares a real word
 * with the answer ("Is it Gosling?" for Ryan Gosling) or contains it run together
 * ("tea pot" for teapot). A guess that names it some other way (a nickname, a
 * translation) won't free the pet; it gets an ordinary yes or no instead.
 */
export function namesAnswer(question: string, answer: string): boolean {
  const a = words(answer);
  const q = words(question);
  if (!a.length) return false;
  if (q.join("").includes(a.join(""))) return true;
  const asked = new Set(q);
  return a.some((w) => w.length >= 3 && asked.has(w));
}
