import type * as acp from "@agentclientprotocol/sdk";
import type { HarnessMethod, HarnessRequests, TurnResumeKind } from "@acp-harness/protocol";
import type { TurnAutoResume } from "../turn-auto-resume.ts";
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
  /** Starts a Continue/Retry/Resume turn without waiting for it; "busy" while a turn runs. */
  startRecovery(sessionId: string, kind: TurnResumeKind): Promise<"started" | "busy" | "gone">;
  /** The daemon-owned resume after a usage limit. */
  autoResume: TurnAutoResume;
  /** External agents' ACP servers, by session. */
  acpAgents: AcpAgentSessions;
  /** Notifies every connected client. */
  broadcast(method: string, params: unknown): void;
  /** Runs one turn no client asked for (automations); permission asks go to an open window. */
  runTurn(sessionId: string, text: string): Promise<acp.StopReason>;
  /** The workspace's directory on this host; throws for unknown ids. */
  workspaceRoot(workspaceId: string): string;
}
