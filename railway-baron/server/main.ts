import { startServer } from "./app";
import { wikipedia } from "./facts";
import { OpenRouterOracle, StubOracle, type Oracle } from "./oracle";
import { RULES } from "../src/shared/rules";

/**
 * Railway Baron's game server. Configured by environment:
 * - `PORT` (default 8788)
 * - `ACCESS_CODE`: needed to create a room; without it, no rooms can be made
 * - `OPENROUTER_API_KEY`, `MODEL` (default `cloudflare/clef-flash`)
 * - `PROVIDER` (default `cloudflare`): always use this OpenRouter provider; empty for any
 * - `FACTS=0` to stop looking the answer up on Wikipedia
 * - `ORACLE=stub` for a pretend robot that costs nothing (local play)
 * - `CALLS_PER_DAY` (default 500): model calls across the server before the robot strikes
 * - `ROUND_SECONDS` (default 480)
 * - `TRUST_PROXY=1` behind fly.io's proxy
 */
const env = process.env;
const model = env.MODEL || "cloudflare/clef-flash";

let oracle: Oracle;
if (env.ORACLE === "stub") {
  oracle = new StubOracle();
  (oracle as StubOracle).delay = 600;
} else {
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set (or use ORACLE=stub)");
  oracle = new OpenRouterOracle({
    apiKey: env.OPENROUTER_API_KEY,
    model,
    provider: env.PROVIDER ?? "cloudflare",
    // One line per model call in the logs, request and response in full.
    log: (b) => console.log(JSON.stringify({ ev: "decision", ...b })),
  });
}

const server = await startServer({
  port: Number(env.PORT ?? 8788),
  accessCode: env.ACCESS_CODE || undefined,
  oracle,
  callsPerDay: Number(env.CALLS_PER_DAY ?? 500),
  roundMs: env.ROUND_SECONDS ? Number(env.ROUND_SECONDS) * 1000 : RULES.roundMs,
  trustProxy: env.TRUST_PROXY === "1",
  lookup: env.FACTS === "0" ? undefined : wikipedia(),
});
console.log(
  `railway-baron server on :${server.port}, oracle ${env.ORACLE === "stub" ? "stub" : model}` +
    (env.ACCESS_CODE ? "" : " (no ACCESS_CODE: nobody can create rooms)"),
);
