import type * as acp from "@agentclientprotocol/sdk";
import { HARNESS_METHODS, isChatAgentId } from "@acp-harness/protocol";
import type { HandlerContext } from "./handler-context.ts";
import { DEFAULT_SESSION_OPTIONS, publicInfo, type SessionRecord } from "../session-registry.ts";

const PERMISSION_MODES = new Set<string>(["default", "acceptEdits", "plan", "auto", "bypassPermissions"]);
import { chatCatalog } from "../claude-catalog.ts";
import {
  conversationBefore,
  conversationUpdates,
  forkConversation,
  listConversations,
} from "../claude-history.ts";
import { liveClaudeQueries } from "../live-claude-queries.ts";
import { mentionFiles } from "../mention-files.ts";
import { noteActivity } from "../session-activity.ts";
import { consultLead } from "../lead-consult.ts";
import { log } from "../log.ts";

type UserChunk = Extract<acp.SessionUpdate, { sessionUpdate: "user_message_chunk" }>;

export function registerSessionHandlers(ctx: HandlerContext): void {
  const { handle, sessions, pendingTurns, acpAgents, workspaceRoot, moveSession } = ctx;
  handle(HARNESS_METHODS.sessionsList, async () => sessions.list());
  handle(HARNESS_METHODS.sessionMove, (p) => moveSession(p));
  handle(HARNESS_METHODS.sessionConsultLead, (p) => consultLead(ctx, p.leadSessionId, p.from, p.question));
  handle(HARNESS_METHODS.sessionAddContext, async (p) => {
    noteActivity(sessions, p.sessionId, p.text);
    return {};
  });
  handle(HARNESS_METHODS.sessionCreate, async (p) => {
    if (p.agent !== undefined && !isChatAgentId(p.agent)) throw new Error(`Unknown agent ${String(p.agent)}`);
    const record = sessions.create({
      workspaceId: p.workspaceId,
      cwd: workspaceRoot(p.workspaceId),
      ...(p.agent && p.agent !== "claude" ? { agent: p.agent } : {}),
      ...(p.role === "manager" ? { role: p.role, title: "Manager" } : {}),
      ...(p.role === "lead" ? { role: p.role, title: "Lead" } : {}),
      ...((!p.agent || p.agent === "claude") && p.permissionMode && PERMISSION_MODES.has(p.permissionMode)
        ? { options: { ...DEFAULT_SESSION_OPTIONS, permissionMode: p.permissionMode } }
        : {}),
    });
    // Started now, as Orca opens a chat's session on create, so its model and mode pickers fill in.
    acpAgents.for(record)?.ensureStarted().catch((error) => log(`starting ${p.agent} failed: ${String(error)}`));
    return publicInfo(record);
  });
  handle(HARNESS_METHODS.sessionClose, async (p) => {
    pendingTurns.get(p.sessionId)?.abort();
    await sessions.remove(p.sessionId);
    return {};
  });

  handle(HARNESS_METHODS.sessionSetOptions, async (p) => {
    const session = requireSession(p.sessionId);
    const options = { ...session.options, ...p.options };
    // A running turn takes what the CLI can switch live; effort applies from the next turn.
    const live = liveClaudeQueries.get(session.id);
    if (live && options.permissionMode !== session.options.permissionMode) {
      await live.setPermissionMode(options.permissionMode);
    }
    if (live && options.model !== session.options.model) await live.setModel(options.model ?? undefined);
    sessions.update(session.id, { options });
    return publicInfo(session);
  });

  handle(HARNESS_METHODS.sessionSetAgentOption, async (p) => {
    const session = requireSession(p.sessionId);
    const agent = acpAgents.for(session);
    if (!agent) throw new Error("Claude chats set options with setOptions");
    await agent.setOption(p.optionId, p.value);
    return publicInfo(session);
  });

  handle(HARNESS_METHODS.sessionCatalog, async (p) => chatCatalog(workspaceRoot(p.workspaceId), p.refresh));

  handle(HARNESS_METHODS.sessionMentionFiles, async (p) => mentionFiles(workspaceRoot(p.workspaceId)));

  handle(HARNESS_METHODS.sessionFork, async (p) => {
    const source = requireSession(p.sessionId);
    requireClaude(source, "Forking");
    const claudeSessionId = source.claudeSessionId
      ? p.fromMessageId
        ? await forkThrough(source, source.claudeSessionId, p.fromMessageId)
        : await forkConversation(source.claudeSessionId, source.cwd)
      : null;
    const fork = sessions.create({
      workspaceId: source.workspaceId,
      cwd: source.cwd,
      title: `${source.title} (fork)`,
      claudeSessionId,
      options: { ...source.options },
    });
    await sessions.replaceTranscript(
      fork.id,
      claudeSessionId ? await conversationUpdates(claudeSessionId, source.cwd) : [],
    );
    return publicInfo(fork);
  });

  handle(HARNESS_METHODS.sessionRewind, async (p) => {
    const session = requireSession(p.sessionId);
    requireClaude(session, "Rewinding");
    if (pendingTurns.has(session.id)) throw new Error("Stop the agent before rewinding");
    const transcript = await sessions.transcript(session.id);
    const isPrompt = (u: acp.SessionUpdate): u is UserChunk => u.sessionUpdate === "user_message_chunk";
    const start = transcript.findIndex((u) => isPrompt(u) && u.messageId === p.messageId);
    if (start === -1) throw new Error("That message is not in this conversation");
    const ordinal = new Set(transcript.slice(0, start).flatMap((u) => (isPrompt(u) && u.messageId ? [u.messageId] : []))).size;
    const claudeSessionId = session.claudeSessionId
      ? await conversationBefore(session.claudeSessionId, session.cwd, p.messageId, ordinal)
      : null;
    const text = transcript
      .slice(start)
      .filter((u): u is UserChunk => isPrompt(u) && u.messageId === p.messageId)
      .flatMap((u) => (u.content.type === "text" ? [u.content.text] : []))
      .join("\n");
    await sessions.replaceTranscript(session.id, transcript.slice(0, start));
    sessions.update(session.id, { claudeSessionId });
    return { text };
  });

  handle(HARNESS_METHODS.sessionHistory, async (p) => {
    const cwd = workspaceRoot(p.workspaceId);
    const open = new Map(
      sessions
        .all()
        .filter((s) => s.workspaceId === p.workspaceId && s.claudeSessionId)
        .map((s) => [s.claudeSessionId, s.id]),
    );
    return (await listConversations(cwd)).map((c) => ({ ...c, openSessionId: open.get(c.claudeSessionId) ?? null }));
  });

  handle(HARNESS_METHODS.sessionResume, async (p) => {
    const existing = sessions
      .all()
      .find((s) => s.workspaceId === p.workspaceId && s.claudeSessionId === p.claudeSessionId);
    if (existing) return publicInfo(existing);
    const cwd = workspaceRoot(p.workspaceId);
    const summary = (await listConversations(cwd)).find((c) => c.claudeSessionId === p.claudeSessionId);
    const updates = await conversationUpdates(p.claudeSessionId, cwd);
    const record = sessions.create({
      workspaceId: p.workspaceId,
      cwd,
      title: (summary?.title ?? "Claude").slice(0, 40),
      claudeSessionId: p.claudeSessionId,
    });
    await sessions.replaceTranscript(record.id, updates);
    return publicInfo(record);
  });

  /** A fork that ends with this prompt's exchange: everything before the next prompt. */
  async function forkThrough(source: SessionRecord, claudeSessionId: string, messageId: string): Promise<string> {
    const transcript = await sessions.transcript(source.id);
    const isPrompt = (u: acp.SessionUpdate): u is UserChunk => u.sessionUpdate === "user_message_chunk";
    const start = transcript.findIndex((u) => isPrompt(u) && u.messageId === messageId);
    if (start === -1) throw new Error("That message is not in this conversation");
    const next = transcript.findIndex((u, i) => i > start && isPrompt(u) && !!u.messageId && u.messageId !== messageId);
    const nextChunk = transcript[next];
    if (next === -1 || !nextChunk || !isPrompt(nextChunk) || !nextChunk.messageId) {
      return forkConversation(claudeSessionId, source.cwd);
    }
    const ordinal = new Set(transcript.slice(0, next).flatMap((u) => (isPrompt(u) && u.messageId ? [u.messageId] : []))).size;
    const fork = await conversationBefore(claudeSessionId, source.cwd, nextChunk.messageId, ordinal);
    if (!fork) throw new Error("That message is not in Claude's transcript");
    return fork;
  }

  /** ACP has no stable fork or rewind; external agents' chats go without (as in Orca). */
  function requireClaude(session: SessionRecord, action: string): void {
    if (session.agent && session.agent !== "claude") throw new Error(`${action} works in Claude chats only`);
  }

  function requireSession(id: string): SessionRecord {
    const session = sessions.get(id);
    if (!session) throw new Error(`Unknown session ${id}`);
    return session;
  }
}
