import type * as acp from "@agentclientprotocol/sdk";
import { HARNESS_METHODS, type SessionInfo } from "@acp-harness/protocol";
import type { HandlerContext } from "./handler-context.ts";
import type { SessionRecord } from "../session-registry.ts";
import { chatCatalog } from "../claude-catalog.ts";
import {
  conversationBefore,
  conversationUpdates,
  forkConversation,
  listConversations,
} from "../claude-history.ts";
import { liveClaudeQueries } from "../live-claude-queries.ts";
import { mentionFiles } from "../mention-files.ts";

type UserChunk = Extract<acp.SessionUpdate, { sessionUpdate: "user_message_chunk" }>;

export function registerSessionHandlers({ handle, sessions, pendingTurns, workspaceRoot }: HandlerContext): void {
  handle(HARNESS_METHODS.sessionsList, async () => sessions.list());
  handle(HARNESS_METHODS.sessionCreate, async (p) =>
    publicInfo(sessions.create({ workspaceId: p.workspaceId, cwd: workspaceRoot(p.workspaceId) })),
  );
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

  handle(HARNESS_METHODS.sessionCatalog, async (p) => chatCatalog(workspaceRoot(p.workspaceId), p.refresh));

  handle(HARNESS_METHODS.sessionMentionFiles, async (p) => mentionFiles(workspaceRoot(p.workspaceId)));

  handle(HARNESS_METHODS.sessionFork, async (p) => {
    const source = requireSession(p.sessionId);
    const claudeSessionId = source.claudeSessionId
      ? await forkConversation(source.claudeSessionId, source.cwd)
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

  function requireSession(id: string): SessionRecord {
    const session = sessions.get(id);
    if (!session) throw new Error(`Unknown session ${id}`);
    return session;
  }
}

function publicInfo(record: SessionRecord): SessionInfo {
  const { claudeSessionId: _hidden, ...info } = record;
  return info;
}
