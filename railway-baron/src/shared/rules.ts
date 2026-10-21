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

export function reply(j: Judgement, rules = RULES): Reply {
  if (j.isYesNo < rules.yesNo) return "refused";
  if (j.isGuess >= rules.guess) return j.guessCorrect >= rules.guessRight ? "correct" : "wrong";
  if (j.yes >= rules.yes) return "yes";
  if (j.yes <= rules.no) return "no";
  return "unsure";
}

/** More than half the rescuers back it (so a lone rescuer's question goes straight away). */
export function agreed(backers: number, rescuers: number): boolean {
  return backers * 2 > rescuers;
}
