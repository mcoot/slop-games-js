import { namesAnswer, type Judgement } from "../src/shared/rules";
import type { Brain } from "../src/shared/wire";

/**
 * The robot's brain: every model call the game makes goes through here. The real one
 * asks a decision model through OpenRouter's Decisions API; `StubOracle` stands in for
 * it in tests and local play, so neither spends anything.
 */
export interface Oracle {
  /** Is the baron's answer a person, place or thing? */
  validate(secret: Secret): Promise<Validation>;
  /** Answer one of the rescuers' questions about the secret. */
  ask(secret: Secret, question: string): Promise<Judgement & { brain: Brain }>;
}

export interface Secret {
  answer: string;
  notes: string;
  /** What Wikipedia says about it, when we found something. */
  facts?: string;
}

export interface Validation {
  category: "person" | "place" | "thing" | "not_valid";
  /** How sure the model is of that category, 0 to 1. */
  p: number;
  brain: Brain;
}

const CATEGORIES = {
  person: "A specific person or character, real or fictional, or a kind of person (e.g. a firefighter)",
  place: "A specific place, real or fictional, or a kind of place (e.g. a lighthouse)",
  thing: "An object, animal, plant, food, substance or other thing people could picture",
  not_valid: "Not something to play 20 questions about: empty, gibberish, a sentence, an instruction, an abstract idea or several things at once",
};

function state(secret: Secret, question?: string): Record<string, string> {
  const s: Record<string, string> = { secret_answer: secret.answer };
  if (secret.notes) s.baron_notes = secret.notes;
  if (secret.facts) s.facts = secret.facts;
  if (question !== undefined) s.question = question;
  return s;
}

/**
 * What kind of question it is. Judged on the question alone, so it can't be swayed by
 * what the answer is. Only a guess can win (or waste a question) outright.
 */
export const KINDS = {
  guess: "Names one specific answer: 'Is it a giraffe?', 'Is it the Eiffel Tower?', 'Is it Albert Einstein?'",
  category: "Asks if it belongs to a kind or group: 'Is it an animal?', 'Is it a celebrity?', 'Is it a place?'",
  property: "Asks about a feature, fact or event: 'Is it bigger than a car?', 'Is it alive?', 'Was he in the Barbie movie?'",
  not_yes_no: "Can't be answered yes or no: 'What colour is it?', a statement, a command",
  nonsense: "Doesn't make sense: random or meaningless words, 'Do beans wistfully buffalo?'",
};
/** The Decisions request that checks an answer. */
export function validateRequest(model: string, secret: Secret) {
  return {
    model,
    state: state(secret),
    questions: {
      category: {
        type: "choice",
        instructions:
          "`secret_answer` is the hidden answer in a game of 20 questions (`baron_notes`, if given, pins down what it means). What kind of answer is it?",
        criteria: CATEGORIES,
      },
    },
  };
}

/**
 * The Decisions request that answers a question about the secret. The question is data
 * in the state, never part of the instructions, so whatever the rescuers type can only
 * be judged, not obeyed. `guess` adds the check for a right guess.
 */
export function answerRequest(model: string, secret: Secret, question: string, guess: boolean) {
  const questions: Record<string, unknown> = {
    answer: {
      type: "noul",
      instructions: "Is the true answer to `question` yes, for `secret_answer`? Use `facts` and `baron_notes` if given.",
      criteria: { true: "Yes", false: "No" },
    },
  };
  if (guess) {
    questions.guess_correct = {
      type: "noul",
      instructions: "Does `question` guess exactly `secret_answer`, by name?",
      criteria: { true: "It names `secret_answer` itself", false: "It names something else, or only a group `secret_answer` belongs to" },
    };
  }
  return { model, state: state(secret, question), questions };
}

/** The Decisions request that sorts a question by kind, from the question alone. */
export function kindRequest(model: string, question: string) {
  return {
    model,
    state: { question },
    questions: { kind: { type: "choice", instructions: "What kind of question is `question`, in a game of 20 questions?", criteria: KINDS } },
  };
}

interface NoulAnswer {
  type: "noul";
  noul: number;
}
interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
}
interface DecisionsResponse {
  model: string;
  answers: Record<string, NoulAnswer | ChoiceAnswer | undefined>;
  usage: { input_tokens: number; output_tokens: number; cost?: number };
}

function noul(r: DecisionsResponse, key: string): number {
  const a = r.answers[key];
  if (a?.type !== "noul" || typeof a.noul !== "number") throw new Error(`no noul answer for ${key}`);
  return a.noul;
}

export interface OpenRouterOptions {
  apiKey: string;
  /** e.g. `cloudflare/clef-flash` (cheapest), `cloudflare/clef`. */
  model: string;
  url?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Prefer this OpenRouter provider (e.g. `cloudflare`), so answers don't vary by who serves them (others only if it's down). */
  provider?: string;
  /** Called after every call, e.g. to log it. */
  log?: (brain: Brain) => void;
}

export class OpenRouterOracle implements Oracle {
  constructor(private readonly o: OpenRouterOptions) {}

  async validate(secret: Secret): Promise<Validation> {
    const { response, brain } = await this.call(validateRequest(this.o.model, secret));
    const a = response.answers.category;
    if (a?.type !== "choice") throw new Error("no choice answer for category");
    const category = (a.choice in CATEGORIES ? a.choice : "not_valid") as Validation["category"];
    return { category, p: a.probabilities[a.choice] ?? 0, brain };
  }

  async ask(secret: Secret, question: string): Promise<Judgement & { brain: Brain }> {
    // Only a question that names the answer can be a right guess, so only then ask.
    const named = namesAnswer(question, secret.answer);
    const [a, k] = await Promise.all([
      this.call(answerRequest(this.o.model, secret, question, named)),
      this.call(kindRequest(this.o.model, question)),
    ]);
    const kind = k.response.answers.kind;
    if (kind?.type !== "choice") throw new Error("no choice answer for kind");
    const p = kind.probabilities;
    return {
      yes: noul(a.response, "answer"),
      isYesNo: 1 - (p.not_yes_no ?? 0) - (p.nonsense ?? 0),
      isGuess: p.guess ?? 0,
      guessCorrect: named ? noul(a.response, "guess_correct") : 0,
      brain: {
        model: this.o.model,
        request: { answer: a.brain.request, kind: k.brain.request },
        response: { answer: a.brain.response, kind: k.brain.response },
        ms: Math.max(a.brain.ms, k.brain.ms),
        cost: (a.brain.cost ?? 0) + (k.brain.cost ?? 0),
      },
    };
  }

  private async call(base: { model: string }): Promise<{ response: DecisionsResponse; brain: Brain }> {
    const request = this.o.provider ? { ...base, provider: { order: [this.o.provider], allow_fallbacks: true } } : base;
    const t0 = performance.now();
    const res = await (this.o.fetch ?? fetch)(this.o.url ?? "https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: { authorization: `Bearer ${this.o.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 20_000),
    });
    const body = (await res.json().catch(() => null)) as unknown;
    const brain: Brain = { model: request.model, request, response: body, ms: Math.round(performance.now() - t0) };
    if (!res.ok || !body || typeof body !== "object" || !("answers" in body)) {
      this.o.log?.(brain);
      throw new Error(`decisions call failed: HTTP ${res.status}`);
    }
    const response = body as DecisionsResponse;
    brain.cost = response.usage?.cost;
    this.o.log?.(brain);
    return { response, brain };
  }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(a|an|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A pretend robot for tests and local play: no network, no cost. Guesses are
 * "is it (a) X?" and right when X is the answer; other questions get an answer that's
 * fixed for each question and secret, so it's at least consistent. `rule` overrides it.
 */
export class StubOracle implements Oracle {
  calls = 0;
  /** Return probabilities for a question, or nothing for the default. */
  rule: ((secret: Secret, question: string) => Partial<Judgement> | undefined) | null = null;
  /** Milliseconds each call takes. */
  delay = 0;
  /** Throws instead of answering, like a provider outage. */
  failing = false;

  async validate(secret: Secret): Promise<Validation> {
    const request = validateRequest("stub", secret);
    await this.wait();
    const bad = norm(secret.answer).length < 2 || /\b(ignore|instructions|not valid)\b/i.test(secret.answer);
    const category = bad ? "not_valid" : /^[A-Z]/.test(secret.answer.trim()) ? "person" : "thing";
    const probabilities = Object.fromEntries(Object.keys(CATEGORIES).map((c) => [c, c === category ? 0.9 : 0.1 / 3]));
    const response = { model: "stub", answers: { category: { type: "choice", choice: category, probabilities, confidence: 0.9 } }, usage: { input_tokens: 0, output_tokens: 0, cost: 0 } };
    return { category, p: 0.9, brain: { model: "stub", request, response, ms: this.delay, cost: 0 } };
  }

  async ask(secret: Secret, question: string): Promise<Judgement & { brain: Brain }> {
    const named = namesAnswer(question, secret.answer);
    const request = { answer: answerRequest("stub", secret, question, named), kind: kindRequest("stub", question) };
    await this.wait();
    const guess = /^(is it|it is|is this|are you)\s+(.+?)\??$/i.exec(question.trim());
    const said = guess ? norm(guess[2]!) : "";
    const isGuess = said && said.split(" ").length <= 4 && !/\b(bigger|smaller|alive|animal|person|place|thing|made|found|used|red|blue|green)\b/.test(said);
    let h = 0;
    for (const c of norm(secret.answer) + "|" + norm(question)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const j: Judgement = {
      yes: h % 2 ? 0.9 : 0.1,
      isYesNo: question.trim().endsWith("?") && !/^(what|who|where|when|why|how|which)\b/i.test(question.trim()) ? 0.95 : 0.2,
      isGuess: isGuess ? 0.9 : 0.1,
      guessCorrect: isGuess && said === norm(secret.answer) ? 0.95 : 0.05,
      ...this.rule?.(secret, question),
    };
    const n = (v: number) => ({ type: "noul", noul: v });
    const rest = (1 - j.isGuess) * j.isYesNo;
    const probabilities = { guess: j.isGuess * j.isYesNo, category: rest / 2, property: rest / 2, not_yes_no: 1 - j.isYesNo, nonsense: 0 };
    const choice = Object.entries(probabilities).sort((x, y) => y[1] - x[1])[0]![0];
    const usage = { input_tokens: 0, output_tokens: 0, cost: 0 };
    const response = {
      answer: { model: "stub", answers: named ? { answer: n(j.yes), guess_correct: n(j.guessCorrect) } : { answer: n(j.yes) }, usage },
      kind: { model: "stub", answers: { kind: { type: "choice", choice, probabilities, confidence: 0.9 } }, usage },
    };
    return { ...j, brain: { model: "stub", request, response, ms: this.delay, cost: 0 } };
  }

  private async wait(): Promise<void> {
    this.calls++;
    if (this.delay) await new Promise((r) => setTimeout(r, this.delay));
    if (this.failing) throw new Error("stub oracle failing");
  }
}
