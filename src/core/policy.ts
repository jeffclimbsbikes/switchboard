import { type Config, workspaces as configWorkspaces, defaultAgentId } from "../config.js";
import type { Caller } from "./api.js";

export interface Access {
  restricted: boolean;
  email?: string;
  agents: string[];
  workspaces: string[];
  defaultAgent: string;
  defaultWorkspace: string;
}

export function normalizeEmail(email: string | undefined): string | undefined {
  const e = email?.trim().toLowerCase();
  return e || undefined;
}

/** Callers without an email, or not listed under `users`, are unrestricted. */
export function resolveAccess(config: Config, caller: Caller = {}): Access {
  const email = normalizeEmail(caller.email);
  const user = email && Object.hasOwn(config.users, email) ? config.users[email] : undefined;
  const allWorkspaces = configWorkspaces(config);
  const globalAgent = defaultAgentId(config);
  const globalWorkspace = (allWorkspaces.find((w) => w.default) ?? allWorkspaces[0])?.id as string;
  if (!user) {
    return {
      restricted: false,
      ...(email && { email }),
      agents: Object.keys(config.agents),
      workspaces: allWorkspaces.map((w) => w.id),
      defaultAgent: globalAgent,
      defaultWorkspace: globalWorkspace,
    };
  }
  const agents = user.agents ?? Object.keys(config.agents);
  const workspaces = user.workspaces ?? allWorkspaces.map((w) => w.id);
  return {
    restricted: true,
    email: email as string,
    agents,
    workspaces,
    defaultAgent: agents.includes(globalAgent) ? globalAgent : (agents[0] ?? globalAgent),
    defaultWorkspace: workspaces.includes(globalWorkspace)
      ? globalWorkspace
      : (workspaces[0] ?? globalWorkspace),
  };
}

export function canSee(access: Access, owner: string | undefined): boolean {
  return !access.restricted || owner === access.email;
}
