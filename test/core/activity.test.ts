import { describe, expect, it } from "vitest";
import { condenseActivity } from "../../src/core/activity.js";
import type { StoredEventData } from "../../src/core/store.js";

describe("condenseActivity", () => {
  it("collapses running and done of the same tool", () => {
    const events: StoredEventData[] = [
      { type: "tool", id: "1", title: "npm test", status: "running" },
      { type: "tool", id: "2", title: "read file", status: "running" },
      { type: "tool", id: "1", title: "npm test", status: "done" },
    ];
    expect(condenseActivity(events)).toEqual(["running: read file", "done: npm test"]);
  });

  it("reports a still-running and a failed tool", () => {
    expect(
      condenseActivity([
        { type: "tool", id: "1", title: "build", status: "running" },
        { type: "tool", id: "2", title: "lint", status: "failed" },
      ]),
    ).toEqual(["running: build", "failed: lint"]);
  });

  it("summarises plans, requests, stops and errors", () => {
    const lines = condenseActivity([
      {
        type: "plan",
        entries: [
          { content: "a", status: "completed" },
          { content: "b", status: "completed" },
          { content: "c", status: "in_progress" },
          { content: "d", status: "pending" },
          { content: "e", status: "pending" },
        ],
      },
      {
        type: "request",
        request: {
          id: "r",
          kind: "question",
          questions: [{ question: "which db?", options: [], multiSelect: false }],
        },
      },
      {
        type: "request",
        request: { id: "s", kind: "approval", tool: "Bash", summary: "rm -rf build", options: [] },
      },
      { type: "turn_end", stopReason: "cancelled" },
      { type: "error", message: "boom", fatal: false },
    ]);
    expect(lines).toEqual([
      "plan: 2 of 5 done",
      "asked: which db?",
      "wants approval: Bash — rm -rf build",
      "stopped",
      "error: boom",
    ]);
  });

  it("keeps only the latest text, truncated", () => {
    const lines = condenseActivity([
      { type: "text", text: "first" },
      { type: "text", text: "x".repeat(500) },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.length).toBeLessThanOrEqual(200);
  });

  it("ignores session and prompt events and bounds the list", () => {
    const events: StoredEventData[] = [
      { type: "session", agentSessionId: "s" },
      { type: "prompt", text: "hi" },
      ...Array.from({ length: 30 }, (_, i): StoredEventData => ({ type: "note", text: `n${i}` })),
    ];
    const lines = condenseActivity(events);
    expect(lines).toHaveLength(12);
    expect(lines.at(-1)).toBe("n29");
  });
});
