# Railway Baron: approach and key decisions

Working title **Tied to the Tracks** (folder and slug `railway-baron`, easy to rename).
A networked game of 20 questions, where the answers come from a decision model.

## The game

An evil railway baron has kidnapped the other players' pet (a snake, a lobster or a
sunfish to start with) and tied it to the tracks. The lever that frees it is guarded
by the baron's robot minion, which he has programmed with a secret answer: a person,
a place or a thing.

- **One baron, one or more rescuers**, in a room joined by invite link.
- The baron picks the pet's fate: the secret answer, plus optional notes that pin
  it down ("a giraffe; specifically a baby one at Taronga Zoo"). The robot checks it
  really is a person, place or thing before it accepts it.
- The rescuers agree on free-text yes/no questions, and the robot answers each one.
- A guess is just a question ("Is it a giraffe?") that the robot recognises as a
  guess. It counts against the 20. A right guess pulls the lever and frees the pet.
- **Two clocks**: 20 questions, and the train, which arrives after a fixed time.
  Running out of either loses.
- The tone stays silly. If the train arrives, the pet gets launched comically into the
  sky, cartoon stars and all, and lands dazed but fine. If the rescuers win, the lever
  switches the points and the train goes off down a siding into the baron's mansion.

## Overall architecture

```
GitHub Pages (static)                       fly.io (syd)
railway-baron/  Three.js + HTML UI  <--ws-->  railway-baron/server  --https-->  OpenRouter
                                              rooms in memory                 Decisions API
                                              OPENROUTER_API_KEY              cloudflare/clef-*
```

- **Frontend**: Vite + TypeScript + Three.js like the other games, deployed with
  them to GitHub Pages through `games.json` (`slop-games.spearritt.dev/railway-baron/`).
  A fixed camera on a small low-poly scene built in code (tracks, pet, lever, robot,
  baron, train in the distance), with HTML popover panels for all interaction. No
  physics, no Blender to start with.
- **Backend**: a small Node server, the same shape as Bondi Ski's (`ws`, rooms in
  memory, one machine, bundled with Vite, Dockerfile built from the repo root). It
  owns the game state, the timers, and every model call; the browser never talks to
  OpenRouter. Its own fly app (`slop-railway-baron`, Sydney, sleeps when idle), deployed
  by CI on master when its paths change, like Bondi Ski's.
- **Shared code**: the wire types and game rules live in the game's `src/` and are
  imported by both sides, as Bondi Ski does. We take what helps from `packages/`
  (core, ui-screens, audio). Nothing of Bondi Ski's networking is general enough to
  pull out into a package yet, so we copy the pattern rather than share the code.

## Key decisions

### 1. Models through OpenRouter's Decisions API

We call `POST https://openrouter.ai/api/alpha/decisions`. It is not the
chat-completions endpoint: a decision model doesn't generate text. It scores the
options we define in one forward pass and returns probabilities. Clef comes in
`cloudflare/clef-flash` (9B, the cheapest and fastest), `cloudflare/clef` (27B) and
`cloudflare/clef-omni`. We start on **clef-flash** and switch with the `MODEL` env var.
Jev (TypeSafe) uses the same request shape, so it can be swapped in the same way.

All model calls go through one small module (`server/oracle.ts`) with three
functions: `validateAnswer`, `ask` and `judgeGuess`. If we later want to compare
against a chat LLM, it is a second implementation of that module, not a rewrite.

### 2. How the robot answers

Each question is one request. `state` holds the secret answer and the baron's notes,
and nothing else (no history), so every answer is judged on its own against the
truth. The request asks several things in one go:

| Question key | Type | Used for |
| --- | --- | --- |
| `answer` | `noul` | The answer itself: "Considering the secret `answer`: <the rescuers' question>" |
| `kind` | `choice` | A guess, a category ("Is it a celebrity?"), a property ("Is it alive?"), or not a yes/no question (refused, doesn't count). One choice, so a guess has to beat a category head to head |
| `guess_correct` | `noul` | Does it name the secret answer itself, not just a group it belongs to? (Only used for guesses) |

A guess only frees the pet when the question's own words name the answer as well
(`namesAnswer` in `src/shared/rules.ts`: a shared word, or the answer run together, so
"Is it Gosling?" counts for Ryan Gosling but "Is it a celebrity?" doesn't). If the model
calls a question a right guess and the words don't name the answer, it gets an ordinary
yes or no. This came from playtesting: with separate yes/no checks, "Is it a
celebrity?" won the round for Ryan Gosling.

The `answer` probability maps to the robot's reply in three bands: **yes** (≥ 0.65),
**no** (≤ 0.35), and **"my circuits are unsure"** in between. The unsure reply still
counts as a question, which is the classic 20 questions rule and rewards clear
questions. The thresholds live in config so we can tune them after playing.

Answer validation when the baron sets the answer is a single `choice` question:
`person`, `place`, `thing`, or `not_valid` (with a description of each). Anything
under a confidence threshold, or `not_valid`, gets bounced back to the baron.

Clef's text state is truncated at about 2K tokens on Workers AI, which is far more
than an answer and a few notes need.

### 3. Seeing what the model is doing

Decision models give no reasoning text, only probabilities, so we make the
probabilities visible:

- **The robot's brain panel**: a toggle in the game showing, for each question, the
  exact request sent (state and questions) and the raw response (every probability,
  the provider, tokens and cost). For the prototype everyone in the room can open it
  once the round is over, and the baron can watch it live.
- **Server logs**: one JSON line per model call (request, response, latency) in the
  fly logs.
- **Command-line tools**: `ask` runs the same requests outside the game, for playing
  with prompts and thresholds, and `eval` scores the model on a small fixed set of
  known cases (about 30 calls, a fraction of a cent on clef-flash). See the README.

### 4. Locking it down

The game spends real money on every question, so a bot finding the server mustn't be
able to run it up. Layers, simplest first:

1. **A shared access code to create a room.** A fly secret (`ACCESS_CODE`). The baron
   types it once (the browser remembers it); without it the server won't create a
   room. Friends join by invite link to an existing room and don't need it, so
   sharing is just sending the link. A room's code is random and unguessable.
2. **Hard caps on the server**: 20 questions per round is already a cap; on top of
   that, a limited number of rounds per room, a per-IP rate limit, and a daily
   budget of model calls across the whole server. Once the daily budget is spent the
   robot "goes on strike" until tomorrow.
3. **The OpenRouter key's own spend limit**, set by you in OpenRouter.

At Clef-flash prices a question costs a few hundred input tokens, so a fraction of a
cent; the caps exist to stop abuse, not normal play. The access code is a speed bump
against bots and strangers, not real security, which is fine for this.

### 5. Rooms, roles and agreeing on questions

- Rooms in memory on one machine, like Bondi Ski. A restart ends the rounds in
  progress, which is fine for a prototype.
- The baron creates the room (with the access code) and shares the link.
- Rescuers **propose** questions into a shared list and **thumbs-up** them. A question
  is sent once a majority of the rescuers have backed it (a lone rescuer's go
  straight away). Anyone can withdraw their own proposal.
- The baron watches, sees the robot's answers live, and gets some taunting emotes.
  The baron can't override the robot.

### 6. The train clock

A fixed time per round (8 minutes to start with), shown as the train getting closer
along the track. The server owns the clock; clients just draw it. While the robot is
answering, the clock keeps running.

### 7. Testing

Whole-system tests rather than small unit tests: each test starts the real server on a
free port and plays over real WebSockets, with only the model swapped for a stub
(`StubOracle`). They cover a round from lobby to freed pet, the yes/no/unsure bands,
refusals and errors not counting, running out of questions, the train arriving while
the robot is thinking, majority agreement, reconnecting to your seat, and who may do
what. The lockdown has its own tests that try every way in we could think of (wrong,
odd or missing codes, no code configured, joining rooms that don't exist or have
closed, game messages before joining, plain HTTP, junk frames) and check that no room
exists and the model was never called. A third set checks the exact requests we send
OpenRouter against its published schema, with fetch faked.

No test calls the real model. That is what `eval` is for: run by hand when changing
prompts, thresholds or models, so checking the model's behaviour costs cents, not
dollars.

## Out of scope for the prototype

Accounts, persistence, matchmaking, more than one machine, a chat LLM fallback,
mobile-specific layouts beyond "it works", and voice.

## Setup you'll need to do once

- Create the fly app: `fly apps create slop-railway-baron`.
- Set its secrets: `fly secrets set -a slop-railway-baron OPENROUTER_API_KEY=... ACCESS_CODE=...`.
- Check the CI `FLY_API_TOKEN` can deploy the new app (an org-wide token can; one
  scoped to `slop-bondi-ski` can't).
