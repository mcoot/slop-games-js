/**
 * Action-based input: bindings map physical inputs (KeyboardEvent.code,
 * "Mouse0".."Mouse4", "WheelUp", "WheelDown") to named actions.
 *
 * Presses are counted rather than sampled, so a tap that starts and ends
 * between two simulation ticks is still seen by the next tick. The mouse
 * wheel only ever produces presses, which is what makes scroll-to-jump work.
 */
export type Bindings<A extends string> = Record<A, string[]>;

export class ActionInput<A extends string> {
  private readonly held = new Set<string>();
  private readonly presses = new Map<A, number>();
  private readonly lookup = new Map<string, A[]>();

  constructor(private bindings: Bindings<A>) {
    this.rebuild();
  }

  setBindings(bindings: Bindings<A>): void {
    this.bindings = bindings;
    this.rebuild();
  }

  getBindings(): Bindings<A> {
    return this.bindings;
  }

  /** True while any input bound to the action is held. */
  isDown(action: A): boolean {
    for (const input of this.bindings[action]) if (this.held.has(input)) return true;
    return false;
  }

  /** Number of presses since the last call, then resets. Call once per tick per action. */
  consumePresses(action: A): number {
    const n = this.presses.get(action) ?? 0;
    this.presses.set(action, 0);
    return n;
  }

  press(input: string): void {
    if (this.held.has(input)) return; // key repeat
    this.held.add(input);
    this.pulse(input);
  }

  release(input: string): void {
    this.held.delete(input);
  }

  /** A press with no hold, e.g. a wheel notch. */
  pulse(input: string): void {
    for (const action of this.lookup.get(input) ?? []) {
      this.presses.set(action, (this.presses.get(action) ?? 0) + 1);
    }
  }

  releaseAll(): void {
    this.held.clear();
  }

  isBound(input: string): boolean {
    return this.lookup.has(input);
  }

  private rebuild(): void {
    this.lookup.clear();
    for (const action of Object.keys(this.bindings) as A[]) {
      for (const input of this.bindings[action]) {
        const list = this.lookup.get(input) ?? [];
        list.push(action);
        this.lookup.set(input, list);
      }
    }
  }
}

/** Wire an ActionInput to DOM keyboard, mouse button and wheel events. Returns an unsubscribe function. */
export function attachDomInput<A extends string>(
  input: ActionInput<A>,
  target: HTMLElement,
  isActive: () => boolean,
): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isActive()) return;
    if (input.isBound(e.code)) e.preventDefault();
    input.press(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => input.release(e.code);
  const onMouseDown = (e: MouseEvent) => {
    if (isActive()) input.press(`Mouse${e.button}`);
  };
  const onMouseUp = (e: MouseEvent) => {
    // Side buttons (3 = back, 4 = forward) navigate the page on release.
    if (isActive() && (e.button === 3 || e.button === 4)) e.preventDefault();
    input.release(`Mouse${e.button}`);
  };
  const onAuxClick = (e: MouseEvent) => {
    if (isActive() && (e.button === 3 || e.button === 4)) e.preventDefault();
  };
  const onWheel = (e: WheelEvent) => {
    if (!isActive()) return;
    // Always swallow the wheel while playing: a sideways scroll (trackpad, Magic Mouse,
    // tilt wheel) is otherwise the browser's swipe-to-go-back gesture.
    e.preventDefault();
    if (e.deltaY !== 0) input.pulse(e.deltaY < 0 ? "WheelUp" : "WheelDown");
  };
  const onBlur = () => input.releaseAll();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  target.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("auxclick", onAuxClick);
  target.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    target.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
    window.removeEventListener("auxclick", onAuxClick);
    target.removeEventListener("wheel", onWheel);
    window.removeEventListener("blur", onBlur);
  };
}
