# Tied to the Tracks (Railway Baron)

Twenty questions against an evil railway baron. He has tied the rescuers' pet to the
tracks and programmed his robot with the answer that releases the lever. The rescuers
agree on yes-or-no questions, and the robot answers each one with a **decision model**
(Cloudflare's Clef, through OpenRouter's Decisions API). They have 20 questions before
the answer is out of reach, and a few minutes before the train arrives.

See [DESIGN.md](DESIGN.md) for the approach and the decisions behind it.

## Playing locally

```sh
pnpm --filter @slop/railway-baron dev-server   # the server on :8788, pretend robot, access code "dev"
pnpm --filter @slop/railway-baron dev          # the game, which finds the local server by itself
```

Open the game, be the baron with the code `dev`, copy the invite link into another
window and join as a rescuer. The pretend robot (`ORACLE=stub`) costs nothing: guesses
are "Is it (a) X?", other answers are made up but consistent, and wh- questions are
refused.

With the real model: `OPENROUTER_API_KEY=... ACCESS_CODE=... pnpm --filter @slop/railway-baron server`.
A deployed game takes `?server=ws://localhost:8788` to use a local server.

## The robot's brain

- **In the game**: the "Robot's brain" panel shows every model call: the probabilities
  that came back (with the thresholds marked) and the exact request and response. The
  baron sees it live; the rescuers see it when the round is over.
- **On the server**: one JSON line per call (`"ev":"decision"`) in the logs (`fly logs`).
- **From the command line**, with `OPENROUTER_API_KEY` set (each call costs a tiny
  fraction of a cent on clef-flash):

```sh
pnpm --filter @slop/railway-baron ask giraffe "Is it an animal?" "Is it a giraffe?"
pnpm --filter @slop/railway-baron ask --check "the concept of justice"
pnpm --filter @slop/railway-baron ask --raw --notes "a baby one" giraffe "Is it tall?"
pnpm --filter @slop/railway-baron eval         # the known cases (tools/cases.ts), scored
MODELS=cloudflare/clef-flash,cloudflare/clef FACTS=both pnpm --filter @slop/railway-baron eval   # side by side
ONLY=Gosling pnpm --filter @slop/railway-baron eval                                            # just some cases
```

The thresholds that turn probabilities into yes, no and unsure are in
[`src/shared/rules.ts`](src/shared/rules.ts); the prompts are in
[`server/oracle.ts`](server/oracle.ts).

## Tests

`pnpm test` from the root runs whole games against a real server over real WebSockets,
with only the model stubbed (`test/game.test.ts`); every way we could think of to make a
room without the access code, and the spending caps (`test/access.test.ts`); and the
exact requests we send OpenRouter, with fetch faked (`test/oracle.test.ts`). None of
them call a real model; `pnpm eval` is the check on the real one.

## Deploying

The game goes to GitHub Pages with the others. The server is its own fly.io app,
`slop-railway-baron` in Sydney, deployed by CI on master when `railway-baron/` changes
(or by hand with `pnpm --filter @slop/railway-baron deploy-server`). Once, first:

```sh
fly apps create slop-railway-baron
fly secrets set -a slop-railway-baron OPENROUTER_API_KEY=sk-or-... ACCESS_CODE=<something to tell friends>
```

Settings are environment variables (see `server/main.ts`): `MODEL`, `PROVIDER`, `FACTS=0`, `CALLS_PER_DAY`
(the whole server's daily cap on model calls; default 500), `ROUND_SECONDS`.
