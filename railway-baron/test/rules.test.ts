import { describe, expect, it } from "vitest";
import { namesAnswer } from "../src/shared/rules";

describe("naming the answer", () => {
  it("takes the answer's own words, however they're written", () => {
    for (const [q, a] of [
      ["Is it Ryan Gosling?", "Ryan Gosling"],
      ["Is it Gosling?", "Ryan Gosling"],
      ["is it ryan gosling", "Ryan Gosling"],
      ["Is it a tea pot?", "teapot"],
      ["Is it teapots?", "teapot"],
      ["Is it the Eiffel Tower?", "Eiffel Tower"],
      ["Is it Einstein?", "Albert Einstein"],
      ["Is it Beyonce?", "Beyoncé"],
      ["Is it a giraffe?", "a giraffe"],
    ]) expect(namesAnswer(q!, a!), `${q} / ${a}`).toBe(true);
  });

  it("doesn't take a category, a description or filler words", () => {
    for (const [q, a] of [
      ["Is it a celebrity?", "Ryan Gosling"],
      ["Is it an actor?", "Ryan Gosling"],
      ["Is it an animal?", "giraffe"],
      ["Is it a person?", "a firefighter"],
      ["Is it the one?", "The Thing"],
      ["Is it in Paris?", "Eiffel Tower"],
    ]) expect(namesAnswer(q!, a!), `${q} / ${a}`).toBe(false);
  });
});
