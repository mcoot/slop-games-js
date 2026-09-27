import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionInput, attachDomInput } from "./actions";

/** A stand-in for DOM event targets: records listeners so tests can fire events. */
class FakeTarget {
  listeners = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener() {}
  fire(type: string, e: Record<string, unknown>) {
    const event = { preventDefault: vi.fn(), ...e };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }
}

describe("attachDomInput", () => {
  let win: FakeTarget;
  beforeEach(() => {
    win = new FakeTarget();
    vi.stubGlobal("window", win);
  });
  afterEach(() => vi.unstubAllGlobals());

  const setup = (active: boolean) => {
    const canvas = new FakeTarget();
    const input = new ActionInput({ jump: ["WheelUp", "WheelDown"] });
    attachDomInput(input, canvas as unknown as HTMLElement, () => active);
    return { canvas, input };
  };

  it("swallows sideways scrolls while playing, so they can't swipe the page back", () => {
    const { canvas, input } = setup(true);
    const sideways = canvas.fire("wheel", { deltaX: 12, deltaY: 0 });
    expect(sideways.preventDefault).toHaveBeenCalled();
    expect(input.consumePresses("jump")).toBe(0);
    const down = canvas.fire("wheel", { deltaX: 0, deltaY: 3 });
    expect(down.preventDefault).toHaveBeenCalled();
    expect(input.consumePresses("jump")).toBe(1);
  });

  it("blocks the mouse back and forward buttons while playing", () => {
    setup(true);
    expect(win.fire("mouseup", { button: 3 }).preventDefault).toHaveBeenCalled();
    expect(win.fire("auxclick", { button: 4 }).preventDefault).toHaveBeenCalled();
    expect(win.fire("mouseup", { button: 0 }).preventDefault).not.toHaveBeenCalled();
  });

  it("leaves the page alone when not playing (menu open)", () => {
    const { canvas } = setup(false);
    expect(canvas.fire("wheel", { deltaX: 12, deltaY: 0 }).preventDefault).not.toHaveBeenCalled();
    expect(win.fire("mouseup", { button: 3 }).preventDefault).not.toHaveBeenCalled();
  });
});
