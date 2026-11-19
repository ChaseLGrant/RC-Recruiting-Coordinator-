import type { Role } from "./types";

export type Action =
  | "view"
  | "search"
  | "follow"
  | "note"
  | "manage_profiles"
  | "run_missions"
  | "import_data"
  | "decide_approvals"
  | "decide_compliance"
  | "send_messages"
  | "manage_camps"
  | "manage_settings"
  | "manage_users"
  | "view_audit";

const MATRIX: Record<Role, Action[]> = {
  head_coach: [
    "view", "search", "follow", "note", "manage_profiles", "run_missions", "import_data",
    "decide_approvals", "send_messages", "manage_camps", "manage_settings", "manage_users", "view_audit",
  ],
  assistant_coach: [
    "view", "search", "follow", "note", "manage_profiles", "run_missions", "import_data",
    "decide_approvals", "send_messages", "manage_camps",
  ],
  compliance: ["view", "decide_compliance", "view_audit", "manage_settings"],
  viewer: ["view"],
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role]?.includes(action) ?? false;
}

export class PermissionError extends Error {
  constructor(action: Action) {
    super(`Your role does not allow: ${action.replace(/_/g, " ")}`);
    this.name = "PermissionError";
  }
}

export function assertCan(role: Role, action: Action): void {
  if (!can(role, action)) throw new PermissionError(action);
}
