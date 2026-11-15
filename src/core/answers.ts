import type { Answer, ApprovalOptionKind, PendingRequest, Question } from "../types.js";
import { SwitchboardError } from "./api.js";

const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
];

function bad(message: string): never {
  throw new SwitchboardError(message, "bad_answer");
}

function speakOptions(q: Question): string {
  return q.options.map((o, i) => `${i + 1}, ${o.label}`).join("; ");
}

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .trim();
}

function matchOption(q: Question, raw: string): string | undefined {
  const t = normalize(raw);
  const byLabel = q.options.find((o) => normalize(o.label) === t);
  if (byLabel) return byLabel.label;
  const stripped = t.replace(/^(?:the|option|number|choice|#)\s*/g, "").replace(/\s+(?:one|option)$/, "");
  const n = /^\d+$/.test(stripped) ? Number(stripped) : ORDINALS.indexOf(stripped) + 1;
  if (n > 0) {
    const option = q.options[n - 1];
    if (!option) bad(`There is no option ${n}. The options are: ${speakOptions(q)}.`);
    return option.label;
  }
  return undefined;
}

function resolveOne(q: Question, text: string): string | string[] {
  const t = text.trim();
  if (!t)
    bad(q.options.length > 0 ? `Which one? The options are: ${speakOptions(q)}.` : "What is the answer?");
  if (q.options.length === 0) return t;
  const whole = matchOption(q, t);
  if (whole) return q.multiSelect ? [whole] : whole;
  if (!q.multiSelect) return t;
  const pieces = t
    .split(/\s*,\s*|\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  const labels = pieces.map((p) => matchOption(q, p) ?? p);
  return pieces.some((p) => matchOption(q, p)) ? labels : t;
}

function resolveQuestions(request: Extract<PendingRequest, { kind: "question" }>, text: string): Answer {
  const qs = request.questions;
  const answers: Record<string, string | string[]> = {};
  const trimmed = text.trim();
  if (qs.length === 1) {
    const q = qs[0] as Question;
    answers[q.question] = resolveOne(q, trimmed);
    return { kind: "question", answers };
  }
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      bad("I could not read that as a JSON object of answers.");
    }
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      for (const q of qs) {
        const value = obj[q.question] ?? (q.header ? obj[q.header] : undefined);
        if (typeof value !== "string" && !Array.isArray(value)) bad(`No answer given for: ${q.question}`);
        answers[q.question] = Array.isArray(value) ? value.map(String) : resolveOne(q, value);
      }
      return { kind: "question", answers };
    }
  }
  const parts = trimmed.split(";").map((p) => p.trim());
  if (parts.length !== qs.length) {
    bad(
      `There are ${qs.length} questions; answer each in order, separated by semicolons: ${qs.map((q) => q.question).join("; ")}`,
    );
  }
  qs.forEach((q, i) => {
    answers[q.question] = resolveOne(q, parts[i] as string);
  });
  return { kind: "question", answers };
}

const ALLOW_ALWAYS = /^(?:allow always|always allow|always)\b/;
const ALLOW = /^(?:allow|yes|yep|yeah|ok|okay|approve|approved|sure|go ahead|do it)\b/;
const DENY = /^(?:deny|denied|no|nope|reject|stop|cancel|don't|dont)\b/;

function resolveApproval(request: Extract<PendingRequest, { kind: "approval" }>, text: string): Answer {
  const t = text.trim();
  const lower = t.toLowerCase();
  const labelled = request.options.find((o) => o.id === t || o.label.toLowerCase() === lower);
  if (labelled) return { kind: "approval", optionId: labelled.id };
  const pick = (kind: ApprovalOptionKind, message?: string): Answer => {
    const option = request.options.find((o) => o.kind === kind);
    if (!option) bad(`That choice is not offered here. Say allow or deny for ${request.tool}.`);
    return { kind: "approval", optionId: option.id, ...(message && { message }) };
  };
  if (ALLOW_ALWAYS.test(lower)) return pick("allow_always");
  if (ALLOW.test(lower)) return pick("allow_once");
  const deny = DENY.exec(lower);
  if (deny) {
    const message = t.slice(deny[0].length).replace(/^[\s,.:;-]+/, "");
    return pick("reject_once", message || undefined);
  }
  return bad(`Do you want to allow or deny ${request.tool}? ${request.summary}`);
}

export function resolveAnswer(request: PendingRequest, text: string): Answer {
  return request.kind === "question" ? resolveQuestions(request, text) : resolveApproval(request, text);
}
