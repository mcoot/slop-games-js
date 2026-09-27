/**
 * Screen-based UIs (kiosks, terminals, machines) as state machines: the game logic
 * implements `ScreenMachine` and says what to show; `ScreenPanel` draws it as a DOM
 * overlay and feeds button presses back. The logic has no DOM, so it's testable
 * headless and could later drive an in-world screen instead.
 */

export interface ScreenButton {
  id: string;
  label: string;
  /** Second line, e.g. a translation or a price. */
  sublabel?: string;
  disabled?: boolean;
  /** Styling hint. `cancel` buttons are also pressed by Escape. */
  kind?: "default" | "primary" | "cancel";
}

export interface ScreenView {
  /** Which screen this is (also set as `data-screen` for styling). */
  screen: string;
  title: string;
  subtitle?: string;
  /** Lines of body text. */
  lines?: string[];
  buttons: ScreenButton[];
  /** Extra buttons shown in a bar below the main ones (e.g. cancel, back). */
  footer?: ScreenButton[];
  /** A status line, e.g. "Please wait". */
  status?: string;
  /** While busy the buttons are shown but can't be pressed. */
  busy?: boolean;
}

export interface ScreenMachine {
  view(): ScreenView;
  /** A button was pressed. Ignore ids that aren't on the current screen. */
  press(id: string): void;
  /** Advance timers (processing delays etc.). */
  update?(dt: number): void;
}

/** Buttons in keyboard order: main buttons are 1–9, footer buttons follow. */
export function allButtons(view: ScreenView): ScreenButton[] {
  return [...view.buttons, ...(view.footer ?? [])];
}

/**
 * Draws a ScreenMachine as an overlay panel. Call `render()` whenever the machine
 * may have changed (e.g. every frame; it only touches the DOM when the view changes).
 * Number keys press the nth enabled-or-not button; Escape presses the cancel button.
 */
export class ScreenPanel {
  readonly element: HTMLElement;
  private machine: ScreenMachine | null = null;
  private lastKey = "";
  private readonly onKey = (e: KeyboardEvent) => this.handleKey(e);
  /**
   * Called right after each press, inside the click or key event, so it can do
   * things browsers only allow during a user gesture (e.g. re-lock the pointer).
   */
  onPress: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    /** Extra class for theming, e.g. "jr-machine". */
    className = "",
  ) {
    this.element = document.createElement("div");
    this.element.className = `screen-panel ${className}`.trim();
    this.element.hidden = true;
    this.element.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
      if (!button || button.disabled || !this.machine) return;
      this.machine.press(button.dataset.id!);
      this.render();
      this.onPress?.();
    });
    parent.appendChild(this.element);
  }

  get isOpen(): boolean {
    return this.machine !== null;
  }

  open(machine: ScreenMachine): void {
    this.machine = machine;
    this.lastKey = "";
    this.element.hidden = false;
    window.addEventListener("keydown", this.onKey);
    this.render();
  }

  close(): void {
    this.machine = null;
    this.element.hidden = true;
    window.removeEventListener("keydown", this.onKey);
  }

  render(): void {
    if (!this.machine) return;
    const view = this.machine.view();
    const key = JSON.stringify(view);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.element.dataset.screen = view.screen;
    this.element.classList.toggle("busy", !!view.busy);
    const button = (b: ScreenButton, n: number) =>
      `<button data-id="${esc(b.id)}" class="${b.kind ?? "default"}"${b.disabled || view.busy ? " disabled" : ""}>` +
      `<span class="key">${n <= 9 ? n : ""}</span><span class="label">${esc(b.label)}</span>` +
      (b.sublabel ? `<span class="sub">${esc(b.sublabel)}</span>` : "") +
      `</button>`;
    let n = 0;
    this.element.innerHTML =
      `<div class="screen-head"><div class="title">${esc(view.title)}</div>` +
      (view.subtitle ? `<div class="subtitle">${esc(view.subtitle)}</div>` : "") +
      `</div>` +
      (view.lines?.length ? `<div class="lines">${view.lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>` : "") +
      `<div class="buttons">${view.buttons.map((b) => button(b, ++n)).join("")}</div>` +
      (view.footer?.length ? `<div class="footer">${view.footer.map((b) => button(b, ++n)).join("")}</div>` : "") +
      (view.status ? `<div class="status">${esc(view.status)}</div>` : "");
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.machine) return;
    const view = this.machine.view();
    if (view.busy) return;
    const buttons = allButtons(view);
    let target: ScreenButton | undefined;
    if (e.key === "Escape") target = buttons.find((b) => b.kind === "cancel");
    else if (/^[1-9]$/.test(e.key)) target = buttons[Number(e.key) - 1];
    if (!target || target.disabled) return;
    e.preventDefault();
    this.machine.press(target.id);
    this.render();
    this.onPress?.();
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
