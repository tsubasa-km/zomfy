import type { HarnessMethod, HarnessRequests } from "@acp-harness/protocol";
import type { AcpAgentSessions } from "../acp-agent-sessions.ts";
import type { SessionRegistry } from "../session-registry.ts";
import type { TerminalManager } from "../terminal-manager.ts";
import type { WorkspaceManager } from "../workspace-manager.ts";

export type Handle = <M extends HarnessMethod>(
  method: M,
  run: (params: HarnessRequests[M]["params"]) => Promise<HarnessRequests[M]["result"]>,
) => void;

/** What every area's `_harness/*` handlers get; each area registers from its own file. */
export interface HandlerContext {
  handle: Handle;
  workspaces: WorkspaceManager;
  sessions: SessionRegistry;
  terminals: TerminalManager;
  /** Running agent turns by session id. */
  pendingTurns: Map<string, AbortController>;
  /** External agents' ACP servers, by session. */
  acpAgents: AcpAgentSessions;
  /** Notifies every connected client. */
  broadcast(method: string, params: unknown): void;
  /** The workspace's directory on this host; throws for unknown ids. */
  workspaceRoot(workspaceId: string): string;
}
