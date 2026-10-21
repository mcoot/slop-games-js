import type { Judgement } from "../src/shared/rules";
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
  if (question !== undefined) s.question = question;
  return s;
}

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
 * The Decisions request for one question. The question is data in the state, never part
 * of the instructions, so whatever the rescuers type can only be judged, not obeyed.
 */
export function askRequest(model: string, secret: Secret, question: string) {
  const about = "In a game of 20 questions, the hidden answer is `secret_answer` (`baron_notes`, if given, pins down what it means). A player asks `question`.";
  return {
    model,
    state: state(secret, question),
    questions: {
      answer: {
        type: "noul",
        instructions: `${about} Answering truthfully about \`secret_answer\`, is the answer to \`question\` yes?`,
        criteria: { true: "Yes, it is true of `secret_answer`", false: "No, it is not true of `secret_answer`" },
      },
      is_yes_no: {
        type: "noul",
        instructions: `${about} Is \`question\` a question that can be answered with yes or no?`,
        criteria: { true: "A yes/no question (including a guess like 'Is it a cat?')", false: "Not a yes/no question: open-ended, a statement, a command, or nonsense" },
      },
      is_guess: {
        type: "noul",
        instructions: `${about} Is \`question\` a direct guess, naming one specific answer (like 'Is it a giraffe?' or 'Is it the Eiffel Tower?')?`,
        criteria: {
          true: "A direct guess at one specific answer",
          false: "Asks about a category, property or feature (like 'Is it an animal?' or 'Is it bigger than a car?')",
        },
      },
      guess_correct: {
        type: "noul",
        instructions: `${about} If \`question\` guesses a specific answer, is the thing it names the same as \`secret_answer\` (ignoring spelling, plurals and articles)?`,
        criteria: { true: "It names `secret_answer`", false: "It names something else, or doesn't name anything" },
      },
    },
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
    const { response, brain } = await this.call(askRequest(this.o.model, secret, question));
    return {
      yes: noul(response, "answer"),
      isYesNo: noul(response, "is_yes_no"),
      isGuess: noul(response, "is_guess"),
      guessCorrect: noul(response, "guess_correct"),
      brain,
    };
  }

  private async call(request: { model: string }): Promise<{ response: DecisionsResponse; brain: Brain }> {
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
    const request = askRequest("stub", secret, question);
    await this.wait();
    const guess = /^(is it|it is|is this|are you)\s+(.+?)\??$/i.exec(question.trim());
    const named = guess ? norm(guess[2]!) : "";
    const isGuess = named && named.split(" ").length <= 4 && !/\b(bigger|smaller|alive|animal|person|place|thing|made|found|used|red|blue|green)\b/.test(named);
    let h = 0;
    for (const c of norm(secret.answer) + "|" + norm(question)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const j: Judgement = {
      yes: h % 2 ? 0.9 : 0.1,
      isYesNo: question.trim().endsWith("?") && !/^(what|who|where|when|why|how|which)\b/i.test(question.trim()) ? 0.95 : 0.2,
      isGuess: isGuess ? 0.9 : 0.1,
      guessCorrect: isGuess && named === norm(secret.answer) ? 0.95 : 0.05,
      ...this.rule?.(secret, question),
    };
    const n = (v: number) => ({ type: "noul", noul: v });
    const answers = { answer: n(j.yes), is_yes_no: n(j.isYesNo), is_guess: n(j.isGuess), guess_correct: n(j.guessCorrect) };
    const response = { model: "stub", answers, usage: { input_tokens: 0, output_tokens: 0, cost: 0 } };
    return { ...j, brain: { model: "stub", request, response, ms: this.delay, cost: 0 } };
  }

  private async wait(): Promise<void> {
    this.calls++;
    if (this.delay) await new Promise((r) => setTimeout(r, this.delay));
    if (this.failing) throw new Error("stub oracle failing");
  }
}
