import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

export interface ArchiveEntry {
  session: string;
  agent: string;
  workspace: string;
  cwd: string;
  owner?: string;
  model?: string;
  title: string;
  state: string;
  created: string;
  updated: string;
  archived: string;
  turns: number;
  cost_usd: number;
  agent_session_id?: string;
  /** Path of the summary, relative to the archive directory. */
  file: string;
  abstract: string;
}

const INDEX = "index.jsonl";

export function readIndex(dir: string): ArchiveEntry[] {
  let text: string;
  try {
    text = readFileSync(join(dir, INDEX), "utf8");
  } catch {
    return [];
  }
  const entries: ArchiveEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as ArchiveEntry;
      if (typeof e.session === "string" && typeof e.file === "string") entries.push(e);
    } catch {}
  }
  return entries;
}

export function appendIndex(dir: string, entry: ArchiveEntry): void {
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  appendFileSync(join(dir, INDEX), `${JSON.stringify(entry)}\n`, { mode: 0o644 });
}

export function entryId(entry: ArchiveEntry): string {
  return basename(entry.file, ".md");
}

/** The summary's absolute path, or undefined if the index points outside the archive. */
export function summaryPath(dir: string, entry: ArchiveEntry): string | undefined {
  const root = resolve(dir);
  const full = resolve(root, entry.file);
  return full.startsWith(root + sep) ? full : undefined;
}
