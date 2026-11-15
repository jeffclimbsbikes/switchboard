import type { StoredEventData } from "./store.js";

const TEXT_LIMIT = 200;

function oneLine(s: string, limit = TEXT_LIMIT): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > limit ? `${t.slice(0, limit - 1).trimEnd()}…` : t;
}

export function describeRequest(request: Extract<StoredEventData, { type: "request" }>["request"]): string {
  if (request.kind === "approval")
    return `wants approval: ${request.tool} — ${oneLine(request.summary, 120)}`;
  const q = request.questions[0];
  return `asked: ${oneLine(q?.question ?? "a question", 160)}`;
}

export function condenseActivity(events: StoredEventData[], limit = 12): string[] {
  const lines: { key?: string; text: string }[] = [];
  const drop = (key: string) => {
    const i = lines.findIndex((l) => l.key === key);
    if (i >= 0) lines.splice(i, 1);
  };
  for (const e of events) {
    switch (e.type) {
      case "tool":
        if (e.status === "running") {
          drop(`tool:${e.id}`);
          lines.push({ key: `tool:${e.id}`, text: `running: ${e.title}` });
        } else if (e.status === "done" || e.status === "failed") {
          drop(`tool:${e.id}`);
          lines.push({ text: `${e.status === "done" ? "done" : "failed"}: ${e.title}` });
        }
        break;
      case "plan": {
        drop("plan");
        const done = e.entries.filter((p) => p.status === "completed").length;
        lines.push({ key: "plan", text: `plan: ${done} of ${e.entries.length} done` });
        break;
      }
      case "request":
        lines.push({ text: describeRequest(e.request) });
        break;
      case "text":
        drop("text");
        if (e.text.trim()) lines.push({ key: "text", text: oneLine(e.text) });
        break;
      case "note":
        lines.push({ text: e.text });
        break;
      case "turn_end":
        if (e.stopReason === "cancelled") lines.push({ text: "stopped" });
        else if (e.stopReason === "refusal") lines.push({ text: "the agent refused" });
        else if (e.stopReason === "max_tokens") lines.push({ text: "ran out of room" });
        break;
      case "error":
        lines.push({ text: `error: ${oneLine(e.message, 160)}` });
        break;
      default:
        break;
    }
  }
  return lines.slice(-limit).map((l) => l.text);
}
