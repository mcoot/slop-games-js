import { OpenRouterOracle } from "../server/oracle";

/**
 * The real oracle, for the command-line tools. Needs `OPENROUTER_API_KEY`. `MODEL` picks
 * the model (default cloudflare/clef-flash) and `PROVIDER` the provider it prefers
 * (default cloudflare; empty for any), as on the server.
 */
export function realOracle(model = process.env.MODEL || "cloudflare/clef-flash"): OpenRouterOracle {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("Set OPENROUTER_API_KEY first (MODEL picks the model, default cloudflare/clef-flash).");
    process.exit(1);
  }
  return new OpenRouterOracle({ apiKey, model, provider: process.env.PROVIDER ?? "cloudflare" });
}
