import { describe, expect, it } from "vitest";
import { resolveAnswer } from "../../src/core/answers.js";
import type { PendingRequest, Question } from "../../src/types.js";

const q = (question: string, labels: string[], multiSelect = false): Question => ({
  question,
  options: labels.map((label) => ({ label })),
  multiSelect,
});
const ask = (...questions: Question[]): PendingRequest => ({ id: "r1", kind: "question", questions });
const approval: PendingRequest = {
  id: "r2",
  kind: "approval",
  tool: "deploy",
  summary: "ship it",
  options: [
    { id: "a", label: "Allow", kind: "allow_once" },
    { id: "b", label: "Always allow", kind: "allow_always" },
    { id: "c", label: "Deny", kind: "reject_once" },
  ],
};

describe("resolveAnswer: single question", () => {
  const req = ask(q("colour?", ["Red", "Blue", "Green"]));
  it.each([
    ["blue", "Blue"],
    ["  BLUE. ", "Blue"],
    ["2", "Blue"],
    ["option 3", "Green"],
    ["the second one", "Blue"],
    ["first", "Red"],
    ["purple", "purple"],
  ])("%s -> %s", (said, expected) => {
    expect(resolveAnswer(req, said)).toEqual({ kind: "question", answers: { "colour?": expected } });
  });

  it("rejects out-of-range numbers and empty text, listing options", () => {
    expect(() => resolveAnswer(req, "7")).toThrow(/no option 7.*1, Red; 2, Blue; 3, Green/);
    expect(() => resolveAnswer(req, "  ")).toThrow(/options are/);
    try {
      resolveAnswer(req, "7");
    } catch (e) {
      expect((e as { code: string }).code).toBe("bad_answer");
    }
  });

  it("accepts free text when there are no options", () => {
    expect(resolveAnswer(ask(q("name?", [])), "Pat")).toEqual({
      kind: "question",
      answers: { "name?": "Pat" },
    });
  });
});

describe("resolveAnswer: multiSelect", () => {
  const req = ask(q("toppings?", ["Cheese", "Olives", "Ham"], true));
  it("splits on commas and 'and'", () => {
    expect(resolveAnswer(req, "cheese, olives and 3")).toEqual({
      kind: "question",
      answers: { "toppings?": ["Cheese", "Olives", "Ham"] },
    });
  });
  it("wraps a single match in an array", () => {
    expect(resolveAnswer(req, "ham")).toEqual({ kind: "question", answers: { "toppings?": ["Ham"] } });
  });
  it("passes unmatched text through as-is", () => {
    expect(resolveAnswer(req, "anchovies")).toEqual({
      kind: "question",
      answers: { "toppings?": "anchovies" },
    });
  });
});

describe("resolveAnswer: several questions", () => {
  const req = ask(q("a?", ["x", "y"]), q("b?", ["p", "q"]));
  it("splits on semicolons in order", () => {
    expect(resolveAnswer(req, "y; 1")).toEqual({ kind: "question", answers: { "a?": "y", "b?": "p" } });
  });
  it("takes a JSON object keyed by question", () => {
    expect(resolveAnswer(req, '{"a?":"x","b?":"q"}')).toEqual({
      kind: "question",
      answers: { "a?": "x", "b?": "q" },
    });
  });
  it("complains when the count is wrong", () => {
    expect(() => resolveAnswer(req, "x")).toThrow(/2 questions/);
    expect(() => resolveAnswer(req, '{"a?":"x"}')).toThrow(/b\?/);
  });
});

describe("resolveAnswer: approval", () => {
  it.each([
    ["yes", "a"],
    ["Allow", "a"],
    ["sure!", "a"],
    ["always", "b"],
    ["allow always", "b"],
    ["no", "c"],
    ["stop", "c"],
  ])("%s -> %s", (said, optionId) => {
    expect(resolveAnswer(approval, said)).toMatchObject({ kind: "approval", optionId });
  });
  it("keeps the rest of a denial as the message", () => {
    expect(resolveAnswer(approval, "no, use staging instead")).toEqual({
      kind: "approval",
      optionId: "c",
      message: "use staging instead",
    });
  });
  it("rejects ambiguity", () => {
    expect(() => resolveAnswer(approval, "hmm maybe")).toThrow(/allow or deny deploy/);
  });
});
