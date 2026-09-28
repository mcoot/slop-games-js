import { describe, expect, it } from "vitest";
import { arrowFor, parseSign } from "./index";

describe("parseSign", () => {
  it("reads rows, style and size from flat custom properties", () => {
    const spec = parseSign({
      type: "sign",
      style: "yellow",
      width: 3,
      double_sided: true,
      row1_ja: "新幹線",
      row1_en: "Shinkansen",
      row1_to: "gate-",
      row2_ja: "きっぷうりば",
      row2_en: "Tickets",
    });
    expect(spec).toEqual({
      style: "yellow",
      width: 3,
      height: 0.6,
      doubleSided: true,
      rows: [
        { ja: "新幹線", en: "Shinkansen", to: "gate-" },
        { ja: "きっぷうりば", en: "Tickets", to: "" },
      ],
    });
  });

  it("ignores empties with no text", () => {
    expect(parseSign({ type: "sign", style: "black" })).toBeNull();
  });
});

describe("arrowFor", () => {
  // A sign facing +Z (towards a reader standing south of it, looking north, -Z).
  const facingSouth = { x: 0, z: 1 };
  it("points ahead, left, right and back from the reader's point of view", () => {
    expect(arrowFor(facingSouth, { x: 0, z: -1 })).toBe("up");
    expect(arrowFor(facingSouth, { x: -1, z: 0 })).toBe("left");
    expect(arrowFor(facingSouth, { x: 1, z: 0 })).toBe("right");
    expect(arrowFor(facingSouth, { x: 0, z: 1 })).toBe("down");
  });
  it("flips left and right for the back of a double-sided sign", () => {
    const back = { x: 0, z: -1 };
    expect(arrowFor(back, { x: -1, z: 0 })).toBe("right");
  });
});
