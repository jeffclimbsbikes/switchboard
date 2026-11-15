import { describe, expect, it } from "vitest";
import { pickName, SESSION_WORDS } from "../../src/core/names.js";

describe("names", () => {
  it("has at least 150 distinct lowercase words", () => {
    expect(SESSION_WORDS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(SESSION_WORDS).size).toBe(SESSION_WORDS.length);
    for (const w of SESSION_WORDS) expect(w).toMatch(/^[a-z]{3,9}$/);
  });

  it("never reuses a name", () => {
    const used = new Set<string>();
    for (let i = 0; i < SESSION_WORDS.length; i++) {
      const name = pickName(used);
      expect(used.has(name)).toBe(false);
      used.add(name);
    }
    expect(used.size).toBe(SESSION_WORDS.length);
  });

  it("falls back to word plus number when exhausted", () => {
    const used = new Set(SESSION_WORDS);
    const a = pickName(used);
    expect(a).toMatch(/^[a-z]+2$/);
    used.add(a);
    const b = pickName(used, () => 0);
    expect(used.has(b)).toBe(false);
    expect(b).toMatch(/^[a-z]+\d+$/);
  });
});
