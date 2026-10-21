import { wikipedia, type Facts } from "../server/facts";
import { RULES, namesAnswer, reply } from "../src/shared/rules";
import type { Reply } from "../src/shared/wire";
import { CASES, SECRETS } from "./cases";
import { realOracle } from "./env";

/**
 * Run the known cases (tools/cases.ts) against the real model and score it: what the
 * robot would say, the probabilities behind it, and the cost. Compares variants side
 * by side: each model in `MODELS`, with and without the Wikipedia facts (`FACTS=both`).
 *
 *   OPENROUTER_API_KEY=... pnpm eval
 *   MODELS=cloudflare/clef-flash,cloudflare/clef FACTS=both pnpm eval
 *   ONLY=Gosling pnpm eval          (just the cases whose answer or question matches)
 *
 * About 2 calls a case per variant: a few cents at most on clef-flash.
 */
const env = process.env;
const models = (env.MODELS || env.MODEL || "cloudflare/clef-flash").split(",").map((m) => m.trim());
const factsModes = env.FACTS === "both" ? [true, false] : [env.FACTS !== "0"];
const only = env.ONLY?.toLowerCase();
const cases = CASES.filter((c) => !only || `${c.answer} ${c.question}`.toLowerCase().includes(only));
const secrets = SECRETS.filter((s) => !only || s.answer.toLowerCase().includes(only));
const variants = models.flatMap((model) => factsModes.map((facts) => ({ model, facts, name: `${model.replace("cloudflare/", "")}${facts ? "+facts" : ""}` })));
if (variants.length * (cases.length * 2 + secrets.length) > 600) {
  console.error("That's over 600 calls; narrow it down with ONLY, MODELS or FACTS.");
  process.exit(1);
}

// Read up on each answer once.
const lookup = wikipedia();
const factsFor = new Map<string, Facts | null>();
if (factsModes.includes(true)) {
  for (const c of cases) {
    const key = `${c.answer}|${c.notes ?? ""}`;
    if (!factsFor.has(key)) factsFor.set(key, await lookup(c.answer, c.notes ?? ""));
  }
  console.log("Read up on:");
  for (const [k, f] of factsFor) console.log(`  ${k.split("|")[0]!.padEnd(20)} ${f ? f.title : "(nothing found)"}`);
}

const pct = (n: number) => `${Math.round(n * 100)}`.padStart(3);
const results: { name: string; right: number; total: number; cost: number; replies: Reply[] }[] = [];

for (const v of variants) {
  const oracle = realOracle(v.model);
  const r = { name: v.name, right: 0, total: 0, cost: 0, replies: [] as Reply[] };
  console.log(`\n== ${v.name}\nAnswers the baron might pick:`);
  for (const s of secrets) {
    const out = await oracle.validate({ answer: s.answer, notes: s.notes ?? "" });
    r.cost += out.brain.cost ?? 0;
    const ok = out.category !== "not_valid" && out.p >= RULES.category;
    r.total++;
    if (ok === s.ok) r.right++;
    console.log(`  ${ok === s.ok ? "✓" : "✗"} ${s.answer.padEnd(34)} ${out.category.padEnd(9)} ${pct(out.p)}%  (want ${s.ok ? "accepted" : "rejected"})`);
  }
  console.log("Questions                                           reply     yes  y/n  guess right");
  for (const c of cases) {
    const facts = v.facts ? factsFor.get(`${c.answer}|${c.notes ?? ""}`)?.text : undefined;
    const j = await oracle.ask({ answer: c.answer, notes: c.notes ?? "", facts }, c.question);
    r.cost += j.brain.cost ?? 0;
    const got = reply(j, namesAnswer(c.question, c.answer));
    r.replies.push(got);
    r.total++;
    if (got === c.expect) r.right++;
    const label = `${c.answer}: ${c.question}`.slice(0, 50).padEnd(50);
    console.log(`  ${got === c.expect ? "✓" : "✗"} ${label} ${got.padEnd(8)} ${pct(j.yes)}  ${pct(j.isYesNo)}  ${pct(j.isGuess)}  ${pct(j.guessCorrect)}${got === c.expect ? "" : `   (want ${c.expect})`}`);
  }
  results.push(r);
}

if (results.length > 1) {
  console.log(`\nSide by side (✗ = not what we wanted):`);
  console.log(`  ${"".padEnd(50)} ${results.map((r) => r.name.slice(0, 16).padEnd(16)).join(" ")}`);
  cases.forEach((c, i) => {
    const cells = results.map((r) => `${r.replies[i] === c.expect ? " " : "✗"}${r.replies[i]}`.padEnd(16));
    console.log(`  ${`${c.answer}: ${c.question}`.slice(0, 50).padEnd(50)} ${cells.join(" ")}`);
  });
}
console.log("\nScore:");
for (const r of results) console.log(`  ${r.name.padEnd(24)} ${r.right}/${r.total}  $${r.cost.toFixed(5)}`);
