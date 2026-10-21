import { RULES, reply } from "../src/shared/rules";
import { realOracle } from "./env";

/**
 * Ask the real model what the robot would, and see everything it says back.
 *
 *   pnpm ask giraffe "Is it an animal?" "Is it a giraffe?"
 *   pnpm ask --check "Bondi Beach"          (would the robot take this answer?)
 *   pnpm ask --notes "the one in Sydney" "Bondi Beach" "Is it a beach?"
 *   pnpm ask --raw giraffe "Is it tall?"    (the full request and response too)
 */
const args = process.argv.slice(2);
const flag = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args.splice(i, 1).length > 0 : false;
};
const option = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const raw = flag("--raw");
const check = flag("--check");
const notes = option("--notes") ?? "";
const [answer, ...questions] = args;
if (!answer || (!check && !questions.length)) {
  console.error('Usage: pnpm ask [--raw] [--notes "..."] <answer> "<question>"...   or   pnpm ask --check <answer>');
  process.exit(1);
}
if (questions.length > 10) {
  console.error("Ten questions at a time, at most.");
  process.exit(1);
}

const oracle = realOracle();
const secret = { answer, notes };
let cost = 0;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`.padStart(6);

if (check) {
  const v = await oracle.validate(secret);
  cost += v.brain.cost ?? 0;
  console.log(`${answer}: ${v.category} (${pct(v.p)}) -> ${v.category !== "not_valid" && v.p >= RULES.category ? "accepted" : "rejected"}  [${v.brain.ms} ms]`);
  if (raw) console.log(JSON.stringify(v.brain, null, 2));
}
for (const q of questions) {
  const j = await oracle.ask(secret, q);
  cost += j.brain.cost ?? 0;
  console.log(
    `${q}\n  -> ${reply(j).toUpperCase()}   yes ${pct(j.yes)}  yes/no ${pct(j.isYesNo)}  guess ${pct(j.isGuess)}  right ${pct(j.guessCorrect)}  [${j.brain.ms} ms]`,
  );
  if (raw) console.log(JSON.stringify(j.brain, null, 2));
}
console.log(`\ncost: $${cost.toFixed(6)}`);
