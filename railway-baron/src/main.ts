import "./style.css";
import { Connection, myToken, serverUrl } from "./net";
import { Stage } from "./scene";
import { RULES, agreed } from "./shared/rules";
import { PETS, TAUNTS, type Asked, type Brain, type PetKind, type Reply, type RoomView, type Taunt } from "./shared/wire";

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const store = {
  get(k: string): string {
    try {
      return localStorage.getItem(`railway-baron-${k}`) ?? "";
    } catch {
      return "";
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(`railway-baron-${k}`, v);
    } catch {}
  },
};

const PET_NAMES: Record<PetKind, string> = { snake: "Noodle the snake", lobster: "Clawdia the lobster", sunfish: "Mola the sunfish" };
const TAUNT_LABELS: Record<Taunt, string> = { laugh: "Cackle", twirl: "Twirl", tophat: "Tip hat" };
const SAYS: Record<Reply, string> = {
  yes: "YES.",
  no: "NO.",
  unsure: "MY CIRCUITS ARE UNSURE.",
  refused: "THAT IS NOT A YES-OR-NO QUESTION. IT DOES NOT COUNT.",
  correct: "CORRECT. RELEASING LEVER.",
  wrong: "INCORRECT GUESS.",
  error: "BZZT. MALFUNCTION. ASK AGAIN.",
};
const BADGES: Record<Reply, string> = {
  yes: "Yes",
  no: "No",
  unsure: "Unsure",
  refused: "Not yes/no",
  correct: "Correct!",
  wrong: "Wrong guess",
  error: "Malfunction",
};

const stage = new Stage($<HTMLCanvasElement>("#stage"));
const params = new URLSearchParams(location.search);
const invited = params.get("room");

let conn: Connection | null = null;
let view: RoomView | null = null;
/** When the train arrives, on our clock. */
let deadline = 0;
let lastAsked = 0;
let endSeen = false;
let bubbleUntil = 0;
let bubbleText = "";

// ---- Joining

const startCard = $("#start");
const startError = $(".error", startCard);
for (const input of startCard.querySelectorAll<HTMLInputElement>("input[name=name]")) input.value = store.get("name");
$<HTMLInputElement>("input[name=code]", startCard).value = store.get("code");
if (invited) {
  $(".join", startCard).hidden = false;
  $(".create", startCard).hidden = true;
}

function begin(first: "create" | "join", form: HTMLFormElement): void {
  const data = new FormData(form);
  const name = String(data.get("name") ?? "").trim();
  store.set("name", name);
  startError.hidden = true;
  const token = myToken();
  const frame =
    first === "create"
      ? { k: "create" as const, code: String(data.get("code") ?? ""), name, token }
      : { k: "join" as const, room: invited ?? "", name, token };
  if (first === "create") store.set("code", frame.k === "create" ? frame.code : "");
  conn?.close();
  conn = new Connection(serverUrl(), frame, name, {
    state: show,
    error: (message, fatal) => {
      if (fatal && !view) {
        startError.textContent = message;
        startError.hidden = false;
        startCard.hidden = false;
      } else toast(message);
    },
    taunt: (t) => stage.doTaunt(t),
    reconnecting: () => toast("Lost the server, reconnecting…"),
  });
}
$<HTMLFormElement>(".create", startCard).addEventListener("submit", (e) => {
  e.preventDefault();
  begin("create", e.target as HTMLFormElement);
});
$<HTMLFormElement>(".join", startCard).addEventListener("submit", (e) => {
  e.preventDefault();
  begin("join", e.target as HTMLFormElement);
});

// ---- The panel

const panel = $("#panel");
const send = (f: Parameters<Connection["send"]>[0]) => conn?.send(f);

$<HTMLFormElement>(".secret", panel).addEventListener("submit", (e) => {
  e.preventDefault();
  const d = new FormData(e.target as HTMLFormElement);
  send({ k: "secret", answer: String(d.get("answer") ?? ""), notes: String(d.get("notes") ?? "") });
});
$(".go", panel).addEventListener("click", () => send({ k: "start" }));
$(".invite", panel).addEventListener("click", async () => {
  if (!view) return;
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", view.room);
  if (params.get("server")) url.searchParams.set("server", params.get("server")!);
  try {
    await navigator.clipboard.writeText(url.href);
    toast("Invite link copied. Send it to the rescuers!");
  } catch {
    prompt("Send this link to the rescuers:", url.href);
  }
});
const pets = $(".pets", panel);
for (const p of PETS) {
  const b = document.createElement("button");
  b.dataset.pet = p;
  b.textContent = PET_NAMES[p];
  b.addEventListener("click", () => send({ k: "pet", pet: p }));
  pets.append(b);
}
$<HTMLFormElement>(".propose", panel).addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("input", e.target as HTMLFormElement);
  if (!input.value.trim()) return;
  send({ k: "propose", text: input.value });
  input.value = "";
});
$(".proposals", panel).addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!b || !view) return;
  const id = Number(b.dataset.id);
  if (b.dataset.act === "withdraw") send({ k: "withdraw", id });
  else send({ k: "back", id, on: b.dataset.act === "back" });
});
for (const t of TAUNTS) {
  const b = document.createElement("button");
  b.textContent = TAUNT_LABELS[t];
  b.addEventListener("click", () => send({ k: "taunt", taunt: t }));
  $(".taunts .row", panel).append(b);
}
$(".brain-toggle", panel).addEventListener("click", () => toggleBrain());
$("#end .brain-open").addEventListener("click", () => toggleBrain(true));
$("#end .again").addEventListener("click", () => send({ k: "again" }));
$("#end .look").addEventListener("click", () => ($("#end").hidden = true));
$("#brain .close").addEventListener("click", () => toggleBrain(false));

function show(v: RoomView): void {
  const first = !view;
  view = v;
  deadline = performance.now() + v.msLeft;
  if (first) {
    startCard.hidden = true;
    panel.hidden = false;
    $("#hud").hidden = false;
    // So a reload comes back to this room.
    const url = new URL(location.href);
    url.searchParams.set("room", v.room);
    history.replaceState(null, "", url);
  }
  const baron = v.role === "baron";
  const playing = v.phase === "playing";
  const over = v.phase === "won" || v.phase === "lost";
  const me = v.members.find((m) => m.id === v.you);
  const rescuers = v.members.filter((m) => m.role === "rescuer" && m.connected);
  const nameOf = (id: string) => v.members.find((m) => m.id === id)?.name ?? "someone";

  stage.setPet(v.pet);
  $("#strike").hidden = !v.onStrike;

  $(".members", panel).innerHTML =
    `<p class="who">You're ${baron ? "the <b>baron</b>" : "a <b>rescuer</b>"}${me ? `, ${esc(me.name)}` : ""}. ` +
    `Rescuing ${esc(PET_NAMES[v.pet])}.</p><ul>` +
    v.members
      .map((m) => `<li class="${m.connected ? "" : "away"}">${m.role === "baron" ? "🎩" : "🧑"} ${esc(m.name)}${m.connected ? "" : " (away)"}</li>`)
      .join("") +
    "</ul>";

  // Lobby
  $(".lobby-baron", panel).hidden = !(baron && v.phase === "lobby");
  $(".lobby-rescuer", panel).hidden = !(!baron && v.phase === "lobby");
  const status = $(".secret-status", panel);
  if (v.thinking && v.phase === "lobby") status.textContent = "The robot is checking it…";
  else if (v.secret) status.innerHTML = `Locked in: <b>${esc(v.secret.answer)}</b> (a ${esc(v.secret.category)}).`;
  else if (v.rejected) status.innerHTML = `<span class="bad">The robot won't take “${esc(v.rejected.answer)}”: ${esc(v.rejected.reason)}</span>`;
  else status.textContent = "";
  const go = $<HTMLButtonElement>(".go", panel);
  go.disabled = !v.ready || !rescuers.length || v.thinking;
  go.title = !v.ready ? "Lock in an answer first" : !rescuers.length ? "Wait for a rescuer to join" : "";
  for (const b of pets.querySelectorAll<HTMLButtonElement>("button")) b.classList.toggle("on", b.dataset.pet === v.pet);
  $(".wait", panel).textContent = v.ready ? "The baron has programmed the robot. The train could leave any moment…" : "Waiting for the baron to program the robot…";

  // Playing
  $(".ask", panel).hidden = !(playing && !baron);
  $(".agree", panel).textContent =
    rescuers.length > 1 ? `A question goes to the robot once more than half of you (${Math.floor(rescuers.length / 2) + 1} of ${rescuers.length}) back it.` : "";
  $(".proposals", panel).innerHTML = v.proposals
    .map((p) => {
      const mine = p.by === v.you;
      const backing = p.backers.includes(v.you);
      const n = p.backers.filter((b) => rescuers.some((r) => r.id === b)).length;
      const button = mine
        ? `<button data-act="withdraw" data-id="${p.id}">Withdraw</button>`
        : `<button data-act="${backing ? "unback" : "back"}" data-id="${p.id}" class="${backing ? "on" : ""}">${backing ? "Backed" : "Back it"}</button>`;
      return `<li><span class="q">${esc(p.text)}</span><span class="by">${esc(nameOf(p.by))} · ${n}/${rescuers.length}${agreed(n, rescuers.length) ? " · next" : ""}</span>${button}</li>`;
    })
    .join("");
  $(".taunts", panel).hidden = !(baron && playing);
  $(".secret-reminder", panel).innerHTML = v.secret ? `The answer is <b>${esc(v.secret.answer)}</b>. Taunt them:` : "";
  $(".log", panel).hidden = !v.asked.length;
  $(".asked", panel).innerHTML = v.asked
    .map(
      (a) =>
        `<li class="${a.n ? "" : "free"}"><span class="n">${a.n || "–"}</span><span class="q">${esc(a.text)}</span><span class="reply ${a.reply}">${BADGES[a.reply]}</span></li>`,
    )
    .join("");
  $(".asked", panel).scrollTop = 1e6;
  const hasBrain = v.asked.some((a) => a.brain) || !!v.secret?.brain || !!v.rejected?.brain;
  $(".brain-toggle", panel).hidden = !hasBrain;
  renderBrain(v);

  // The robot
  if (v.thinking) say("COMPUTING…", "thinking", Infinity);
  else if (v.asked.length > lastAsked) {
    const a = v.asked.at(-1)!;
    say(SAYS[a.reply], a.reply, 6000);
  } else if (v.phase === "lobby") say(v.ready ? "SECRET LOCKED IN. HA. HA." : baron ? "AWAITING PROGRAMMING, MASTER." : "BEEP. I GUARD THE LEVER.", "idle", Infinity);
  else if (bubbleUntil === Infinity) say("ASK. ME. A. QUESTION.", "idle", Infinity);
  lastAsked = v.asked.length;

  // The end
  stage.ending(v.outcome ?? null);
  if (over && !endSeen) {
    endSeen = true;
    setTimeout(() => showEnd(v), 5000);
  }
  if (!over) {
    // Back in the lobby after a round: a fresh answer.
    if (endSeen) $<HTMLFormElement>(".secret", panel).reset();
    endSeen = false;
    $("#end").hidden = true;
  }
  $("#hud .clock").hidden = over;
  if (over) $("#end .again").hidden = !baron;
}

function showEnd(v: RoomView): void {
  if (view?.phase !== v.phase) return;
  const pet = PET_NAMES[v.pet];
  const end = $("#end");
  const [title, story] =
    v.outcome === "freed"
      ? ["Freed!", `${pet} is free! The lever throws the points and the train thunders off into the baron's mansion. Curses!`]
      : v.outcome === "train"
        ? ["Boing!", `Too slow! The train boinks ${pet} high into the sky. It lands dazed, a bit dusty, and entirely fine.`]
        : ["Out of questions!", `Twenty questions and no answer. The train boinks ${pet} into the sky. It lands dazed but entirely fine.`];
  $("h1", end).textContent = title;
  $(".story", end).textContent = story;
  $(".answer", end).innerHTML = v.secret ? `The answer was <b>${esc(v.secret.answer)}</b>${v.secret.notes ? ` (${esc(v.secret.notes)})` : ""}.` : "";
  end.hidden = false;
}

function say(text: string, mood: Reply | "thinking" | "idle", ms: number): void {
  bubbleText = text;
  bubbleUntil = ms === Infinity ? Infinity : performance.now() + ms;
  const b = $("#bubble");
  b.textContent = text;
  b.className = mood;
  b.hidden = false;
  stage.setRobot(mood);
}

let toastTimer = 0;
function toast(message: string): void {
  const t = $("#toast");
  t.textContent = message;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("on"), 3500);
}

// ---- The robot's brain

let brainKey = "";
function toggleBrain(on?: boolean): void {
  const b = $("#brain");
  b.hidden = on === undefined ? !b.hidden : !on;
}

function bar(label: string, p: number, marks: number[]): string {
  return `<div class="bar"><span class="l">${label}</span><span class="track">${marks.map((m) => `<i style="left:${m * 100}%"></i>`).join("")}<b style="width:${(p * 100).toFixed(1)}%"></b></span><span class="v">${(p * 100).toFixed(1)}%</span></div>`;
}

function answers(brain: Brain): Record<string, { noul?: number; probabilities?: Record<string, number> } | undefined> {
  return (brain.response as { answers?: Record<string, never> } | null)?.answers ?? {};
}

function rawBlock(brain: Brain): string {
  return `<details><summary>Request and response (${brain.ms} ms${brain.cost !== undefined ? `, $${brain.cost.toFixed(6)}` : ""}, ${esc(brain.model)})</summary><pre>${esc(JSON.stringify({ request: brain.request, response: brain.response }, null, 2))}</pre></details>`;
}

function renderBrain(v: RoomView): void {
  const entries: string[] = [];
  const check = v.secret?.brain ?? v.rejected?.brain;
  const checked = v.secret?.answer ?? v.rejected?.answer;
  if (check) {
    const a = answers(check).category;
    const probs = a?.probabilities ?? {};
    entries.push(
      `<article><h3>Checking the answer: “${esc(checked ?? "")}”</h3>${Object.entries(probs)
        .map(([k, p]) => bar(k, p, [RULES.category]))
        .join("")}${rawBlock(check)}</article>`,
    );
  }
  for (const a of v.asked) if (a.brain) entries.push(askedEntry(a, a.brain));
  const key = `${entries.length}:${v.phase}:${check ? 1 : 0}`;
  if (key === brainKey) return;
  brainKey = key;
  $("#brain .entries").innerHTML = entries.length ? entries.reverse().join("") : `<p class="hint">Nothing yet.</p>`;
}

function askedEntry(a: Asked, brain: Brain): string {
  const r = answers(brain);
  const p = (k: string) => r[k]?.noul ?? 0;
  const kind = r.kind?.probabilities ?? {};
  return `<article><h3>${a.n ? `Q${a.n}` : "—"}: “${esc(a.text)}” <span class="reply ${a.reply}">${BADGES[a.reply]}</span></h3>
    ${bar("yes", p("answer"), [RULES.no, RULES.yes])}
    ${bar("a guess", kind.guess ?? 0, [RULES.guess])}
    ${bar("a category", kind.category ?? 0, [])}
    ${bar("a property", kind.property ?? 0, [])}
    ${bar("not yes/no", kind.not_yes_no ?? 0, [1 - RULES.yesNo])}
    ${bar("guess right", p("guess_correct"), [RULES.guessRight])}
    <p class="named">Names the answer in so many words: <b>${a.named ? "yes" : "no"}</b>${a.named ? "" : " (so it can't win outright)"}</p>
    ${rawBlock(brain)}</article>`;
}

// ---- Every frame: the clock, the train and the robot's bubble

function frame(): void {
  requestAnimationFrame(frame);
  if (!view) return;
  const left = view.phase === "playing" ? Math.max(0, deadline - performance.now()) : view.msLeft;
  const s = Math.ceil(left / 1000);
  $("#hud .time").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  $("#hud .clock").classList.toggle("late", view.phase === "playing" && left < 60_000);
  $("#hud .n").textContent = String(view.questionsLeft);
  stage.setTrain(left, view.roundMs);
  const b = $("#bubble");
  if (performance.now() > bubbleUntil && bubbleText) {
    say(view.phase === "playing" ? "ASK. ME. A. QUESTION." : "…", "idle", Infinity);
  }
  const p = stage.robotOnScreen();
  // Kept on screen, however narrow.
  const half = Math.min(b.offsetWidth / 2, innerWidth / 2);
  const x = Math.min(Math.max(p.x, half + 8), innerWidth - half - 8);
  b.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(p.y, b.offsetHeight + 60))}px) translate(-50%, -100%)`;
}
requestAnimationFrame(frame);
