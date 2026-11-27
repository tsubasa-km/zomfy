import type * as acp from "@agentclientprotocol/sdk";
import type { MoveSessionParams, MoveSessionResult, Workspace } from "@zomfy/protocol";
import { chatAgentLaunch } from "./chat-agent-launch-settings.ts";
import { moveClaudeConversation } from "./claude-conversation-move.ts";
import { releaseFinishedTurn } from "./claude-turn.ts";
import { pendingHandoff } from "./agent-handoff.ts";
import { publicInfo, type SessionRegistry } from "./session-registry.ts";
import type { WorkspaceManager } from "./workspace-manager.ts";

// A chat moving to another workspace, e.g. a quick chat the agent files under a project. A move
// asked for mid-turn (the agent's move_chat) waits for the turn to end, then the chat continues there.

interface Deps {
  workspaces: WorkspaceManager;
  sessions: SessionRegistry;
  pendingTurns: Map<string, AbortController>;
  emit(sessionId: string, update: acp.SessionUpdate): Promise<void>;
  /** Stops a Codex or ACP chat's agent process, so its next turn starts it in the chat's new folder. */
  releaseAgent?(sessionId: string): void;
}

export class SessionMover {
  /** Session id → workspace it moves to once its turn ends. */
  private readonly pending = new Map<string, string>();
  /** Session id → folder it follows its workspace to (the project was relocated) once its turn ends. */
  private readonly following = new Map<string, string>();

  constructor(private readonly deps: Deps) {}

  async move(params: MoveSessionParams): Promise<MoveSessionResult> {
    const { sessions, workspaces, pendingTurns } = this.deps;
    const session = sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session ${params.sessionId}`);
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

  /**
   * The chat's own workspace now lives in `cwd` (its project was pointed at another folder): the chat
   * and its Claude conversation follow, after the turn when one runs. Returns whether it waits for that.
   */
  async follow(sessionId: string, cwd: string): Promise<boolean> {
    if (this.deps.pendingTurns.has(sessionId)) {
      this.following.set(sessionId, cwd);
      return true;
    }
    await this.relocate(sessionId, cwd);
    return false;
  }

  /** After any turn, however it ended: a chat whose folder moved under it follows now. */
  async followAfterTurn(sessionId: string): Promise<void> {
    const cwd = this.following.get(sessionId);
    if (cwd === undefined) return;
    this.following.delete(sessionId);
    await this.relocate(sessionId, cwd);
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

  /** A move waits for the chat's running turn to end. */
  hasPending(sessionId: string): boolean {
    return this.pending.has(sessionId);
  }

  forget(sessionId: string): void {
    this.pending.delete(sessionId);
    this.following.delete(sessionId);
  }

  private async relocate(sessionId: string, cwd: string): Promise<void> {
    const { sessions, emit } = this.deps;
    const session = sessions.get(sessionId);
    if (!session || session.cwd === cwd) return;
    // Claude's conversation follows even while another agent runs the chat, so changing back finds it.
    if (session.claudeSessionId) {
      await releaseFinishedTurn(sessionId);
      await moveClaudeConversation(session.claudeSessionId, session.cwd, cwd, (await chatAgentLaunch("claude")).env);
    }
    this.deps.releaseAgent?.(sessionId);
    sessions.update(sessionId, { cwd });
    await emit(sessionId, { sessionUpdate: "notice", severity: "info", title: `The project moved; this chat now runs in ${cwd}` });
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
    // The chat's own agent stops here and reopens its conversation in the new folder on the next
    // turn (Codex resumes a thread anywhere); one that cannot starts anew, handed the chat so far.
    const agent = session.agent && session.agent !== "claude" ? session.agent : null;
    const kept = agent ? session.agentSessionIds?.[agent] : undefined;
    this.deps.releaseAgent?.(sessionId);
    sessions.update(sessionId, {
      workspaceId: target.id,
      cwd: target.path,
      promptSuggestion: null,
      // Other agents that ran this chat keep their conversations by folder, and ACP cannot move them:
      // one the chat returns to starts anew, told the whole conversation.
      agentSessionIds: agent && kept ? { [agent]: kept } : {},
      // What Claude is still to be told on taking the chat back names the folder to work in.
      ...(session.handoffContext
        ? {
            handoffContext: pendingHandoff(await sessions.transcript(sessionId), {
              agent: "claude",
              cwd: target.path,
              resumes: session.claudeSessionId !== null,
            }),
          }
        : {}),
    });
    await emit(sessionId, {
      sessionUpdate: "notice",
      severity: "info",
      title: `Moved to ${target.displayName ?? target.name} · ${target.path}`,
    });
    if (from && !sessions.all().some((s) => s.workspaceId === from)) await workspaces.removeScratchIfEmpty(from);
  }
}
