import type * as acp from "@agentclientprotocol/sdk";
import type { MoveSessionParams, MoveSessionResult, Workspace } from "@acp-harness/protocol";
import { chatAgentLaunch } from "./chat-agent-launch-settings.ts";
import { moveClaudeConversation } from "./claude-conversation-move.ts";
import { releaseFinishedTurn } from "./claude-turn.ts";
import { publicInfo, type SessionRegistry } from "./session-registry.ts";
import type { WorkspaceManager } from "./workspace-manager.ts";

// A chat moving to another workspace, e.g. a quick chat the agent files under a project. A move
// asked for mid-turn (the agent's move_chat) waits for the turn to end, then the chat continues there.

interface Deps {
  workspaces: WorkspaceManager;
  sessions: SessionRegistry;
  pendingTurns: Map<string, AbortController>;
  emit(sessionId: string, update: acp.SessionUpdate): Promise<void>;
}

export class SessionMover {
  /** Session id → workspace it moves to once its turn ends. */
  private readonly pending = new Map<string, string>();

  constructor(private readonly deps: Deps) {}

  async move(params: MoveSessionParams): Promise<MoveSessionResult> {
    const { sessions, workspaces, pendingTurns } = this.deps;
    const session = sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);
    if (session.agent && session.agent !== "claude") throw new Error("Only Claude chats can move to another workspace");
    const target = params.workspaceId
      ? await this.workspace(params.workspaceId)
      : params.folder
        ? await workspaces.workspaceForFolder(params.folder)
        : null;
    if (!target) throw new Error("Give the workspace or folder to move to");
    if (target.id === session.workspaceId) return { session: publicInfo(session), workspaceId: target.id, moved: true };
    if (pendingTurns.has(session.id)) {
      this.pending.set(session.id, target.id);
      return { session: publicInfo(session), workspaceId: target.id, moved: false };
    }
    await this.apply(session.id, target);
    return { session: publicInfo(sessions.get(session.id) ?? session), workspaceId: target.id, moved: true };
  }

  /** After a turn: the move it asked for happens now; returns the prompt that carries on there. */
  async turnEnded(sessionId: string): Promise<string | null> {
    const workspaceId = this.pending.get(sessionId);
    if (!workspaceId) return null;
    this.pending.delete(sessionId);
    const target = await this.workspace(workspaceId);
    await this.apply(sessionId, target);
    const where = target.branch ? `${target.path} (branch ${target.branch})` : target.path;
    return `This chat now runs in ${where}, which is your working directory from here on. Continue the task.`;
  }

  forget(sessionId: string): void {
    this.pending.delete(sessionId);
  }

  private async workspace(workspaceId: string): Promise<Workspace> {
    const found = (await this.deps.workspaces.snapshot()).workspaces.find((w) => w.id === workspaceId);
    if (!found || found.id === "floating") throw new Error(`Unknown workspace ${workspaceId}`);
    return found;
  }

  private async apply(sessionId: string, target: Workspace): Promise<void> {
    const { sessions, workspaces, emit } = this.deps;
    const session = sessions.get(sessionId);
    if (!session) return;
    const from = session.workspaceId;
    if (session.claudeSessionId) {
      await releaseFinishedTurn(sessionId);
      await moveClaudeConversation(session.claudeSessionId, session.cwd, target.path, (await chatAgentLaunch("claude")).env);
    }
    sessions.update(sessionId, { workspaceId: target.id, cwd: target.path, promptSuggestion: null });
    await emit(sessionId, {
      sessionUpdate: "notice",
      severity: "info",
      title: `Moved to ${target.displayName ?? target.name} · ${target.path}`,
    });
    if (from && !sessions.all().some((s) => s.workspaceId === from)) await workspaces.removeScratchIfEmpty(from);
  }
}
