import { describe, expect, it } from "vitest";
import { findFocus, type Interactable } from "./index";

const at = (id: string, x: number, y: number, z: number, extra: Partial<Interactable> = {}): Interactable => ({
  id,
  position: { x, y, z },
  prompt: id,
  ...extra,
});
const eye = { x: 0, y: 1.6, z: 0 };
const ahead = { x: 0, y: 0, z: -1 };

describe("findFocus", () => {
  it("picks what's in front and in reach", () => {
    expect(findFocus(eye, ahead, [at("a", 0, 1.4, -1.5)])?.id).toBe("a");
    expect(findFocus(eye, ahead, [at("far", 0, 1.6, -3)])).toBeNull();
    expect(findFocus(eye, ahead, [at("behind", 0, 1.6, 1)])).toBeNull();
    expect(findFocus(eye, ahead, [at("side", 1.5, 1.6, -0.5)])).toBeNull();
  });

  it("prefers the one nearest the centre of view", () => {
    const items = [at("edge", 0.5, 1.6, -1.5), at("centre", 0.05, 1.6, -1.8)];
    expect(findFocus(eye, ahead, items)?.id).toBe("centre");
  });

  it("skips disabled, blocked and out-of-range items", () => {
    expect(findFocus(eye, ahead, [at("off", 0, 1.6, -1, { enabled: () => false })])).toBeNull();
    expect(findFocus(eye, ahead, [at("walled", 0, 1.6, -1)], undefined, () => true)).toBeNull();
    expect(findFocus(eye, ahead, [at("long-reach", 0, 1.6, -4, { range: 5 })])?.id).toBe("long-reach");
  });
});
