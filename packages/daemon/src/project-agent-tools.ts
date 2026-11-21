import type { ManagerToolName, Project } from "@zomfy/protocol";

// A project's settings can keep its agents from reaching for some harness tools on their own. The
// tools are left out of what the agent is offered, a call that still comes in (a list fetched
// before the setting changed) is refused with the reason, and the chat's instructions say so, so
// the agent can tell the person instead of looking for a way around it.

const TOOL_SETTINGS = [
  {
    tool: "run_workflow",
    off: (p: Project) => p.agentWorkflows === false,
    what: "start workflows (run_workflow)",
    setting: "Agents can start workflows",
  },
  {
    tool: "split_work",
    off: (p: Project) => p.agentSplitWork === false,
    what: "split work into parallel worktrees (split_work)",
    setting: "Agents can split work into parallel worktrees",
  },
] as const satisfies readonly { tool: ManagerToolName; off: (p: Project) => boolean; what: string; setting: string }[];

/** Why `tool` is off for agents in `project`, or null when its settings allow it. */
export function projectToolRefusal(project: Project | null, tool: ManagerToolName): string | null {
  const entry = project && TOOL_SETTINGS.find((s) => s.tool === tool && s.off(project));
  if (!entry) return null;
  return `This project's settings do not let agents ${entry.what} on their own. Do the work in this chat instead, or ask the person to turn on "${entry.setting}" in the project's settings.`;
}

/** The line a chat's instructions carry while its project turns tools off; null when none are. */
export function projectToolsOffNote(project: Project | null): string | null {
  const off = project ? TOOL_SETTINGS.filter((s) => s.off(project)) : [];
  if (off.length === 0) return null;
  return `Zomfy: this project's settings do not let agents ${off.map((s) => s.what).join(" or ")} on their own. Do that work in this chat yourself; if the person asks for it, tell them it is turned off in the project's settings (${off.map((s) => `"${s.setting}"`).join(", ")}).`;
}
