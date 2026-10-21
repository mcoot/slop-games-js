import { RULES, reply } from "../src/shared/rules";
import { CASES, SECRETS } from "./cases";
import { realOracle } from "./env";

/**
 * Run the known cases (tools/cases.ts) against the real model and score it: what the
 * robot would say, the probabilities behind it, and the total cost. About 30 cheap calls.
 *
 *   OPENROUTER_API_KEY=... pnpm eval
 *   MODEL=cloudflare/clef pnpm eval
 */
const oracle = realOracle();
let cost = 0;
let right = 0;
const pct = (n: number) => `${Math.round(n * 100)}`.padStart(3);

console.log("Answers the baron might pick:");
for (const s of SECRETS) {
  const v = await oracle.validate({ answer: s.answer, notes: s.notes ?? "" });
  cost += v.brain.cost ?? 0;
  const ok = v.category !== "not_valid" && v.p >= RULES.category;
  if (ok === s.ok) right++;
  console.log(`  ${ok === s.ok ? "✓" : "✗"} ${s.answer.padEnd(34)} ${v.category.padEnd(9)} ${pct(v.p)}%  (want ${s.ok ? "accepted" : "rejected"})`);
}

console.log("\nQuestions                                           reply     yes  y/n  guess right");
for (const c of CASES) {
  const j = await oracle.ask({ answer: c.answer, notes: c.notes ?? "" }, c.question);
  cost += j.brain.cost ?? 0;
  const r = reply(j);
  if (r === c.expect) right++;
  const label = `${c.answer}: ${c.question}`.slice(0, 50).padEnd(50);
  console.log(`  ${r === c.expect ? "✓" : "✗"} ${label} ${r.padEnd(8)} ${pct(j.yes)}  ${pct(j.isYesNo)}  ${pct(j.isGuess)}  ${pct(j.guessCorrect)}${r === c.expect ? "" : `   (want ${c.expect})`}`);
}

const total = SECRETS.length + CASES.length;
console.log(`\n${right}/${total} as expected on ${process.env.MODEL || "cloudflare/clef-flash"}, cost $${cost.toFixed(6)}`);
