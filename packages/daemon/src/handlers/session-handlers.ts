import type * as acp from "@agentclientprotocol/sdk";
import { HARNESS_METHODS, NEW_CHAT_TITLE, chatAgentLabel, isChatAgentId, type ChatAgentId } from "@zomfy/protocol";
import type { HandlerContext } from "./handler-context.ts";
import { DEFAULT_SESSION_OPTIONS, publicInfo, type SessionRecord } from "../session-registry.ts";

const PERMISSION_MODES = new Set<string>(["default", "acceptEdits", "plan", "auto", "bypassPermissions"]);
import { chatCatalog } from "../claude-catalog.ts";
import { conversationBefore, conversationUpdates, forkConversation } from "../claude-history.ts";
import { importConversation, pastConversations } from "../agent-conversations.ts";
import { liveClaudeQueries } from "../live-claude-queries.ts";
import { agentEras, agentSwitchNotice, answeredBefore, pendingHandoff, type AgentEra } from "../agent-handoff.ts";
import { emptyAgentState } from "../acp-agent-session.ts";
import { refuseUnattended, resolveChatAgent } from "../chat-agent-launch-specs.ts";
import { releaseFinishedTurn } from "../claude-turn.ts";
import { CLAUDE_SIGN_IN_ARGS, resolveClaudeExecutable } from "../claude-executable.ts";
import { chatAgentLaunch } from "../chat-agent-launch-settings.ts";
import { mentionFiles } from "../mention-files.ts";
import { noteActivity } from "../session-activity.ts";
import { consultRequester } from "../requester-consult.ts";
import { log } from "../log.ts";
import { connectorPresets } from "../connector-presets.ts";

type UserChunk = Extract<acp.SessionUpdate, { sessionUpdate: "user_message_chunk" }>;

/** The chat's model and permission mode, as the CLI takes them, so the conversation carries on as it was. */
function cliOptions(options: SessionRecord["options"]): string[] {
  return [
    ...(options.model ? ["--model", options.model] : []),
    ...(options.permissionMode !== "default" ? ["--permission-mode", options.permissionMode] : []),
  ];
}

export function registerSessionHandlers(ctx: HandlerContext): void {
  const { handle, sessions, pendingTurns, acpAgents, autoResume, emit, workspaceRoot, moveSession } = ctx;
  handle(HARNESS_METHODS.sessionsList, async () => sessions.list());
  handle(HARNESS_METHODS.sessionMove, (p) => moveSession(p));
  handle(HARNESS_METHODS.sessionContinueInTerminal, async (p) => {
    const record = sessions.get(p.sessionId);
    if (!record?.workspaceId) throw new Error("This thread has no folder to open a terminal in.");
    if (record.agent && record.agent !== "claude") throw new Error("Only Claude threads continue in a terminal.");
    if (pendingTurns.has(record.id) || record.status === "working") throw new Error("Wait for the thread's turn to end, or stop it, first.");
    if (!record.claudeSessionId) throw new Error("The thread has no conversation to continue yet: send it a message first.");
    const split = ctx.splitBusy(record.id);
    if (split) throw new Error(`${split} The CLI would work in this folder without knowing about them.`);
    // Taken before anything is awaited, so no turn (an auto-resume, a split's report) starts meanwhile.
    if (!ctx.cli.reserve(record.id)) throw new Error("This thread's conversation is already open in a Claude terminal.");
    let terminalId: string | null = null;
    try {
      const exe = await resolveClaudeExecutable();
      if (!exe) throw new Error("Claude Code was not found on this host. Install it and run claude once to sign in.");
      // The last turn's process may still hold the conversation for its prompt suggestion.
      await releaseFinishedTurn(record.id);
      // Started as the terminal's program, with the env the chat's turns get (a config dir, say), so
      // it opens the same conversation under the same account; the tab keeps its output after exit.
      const info = await ctx.terminals.create({
        workspaceId: record.workspaceId,
        cwd: record.cwd,
        cols: 120,
        rows: 30,
        program: {
          argv: [exe, "--resume", record.claudeSessionId, ...cliOptions(record.options)],
          title: "Claude",
          env: (await chatAgentLaunch("claude")).env,
        },
      });
      terminalId = info.id;
      await emit(record.id, {
        sessionUpdate: "notice",
        severity: "info",
        title: "Continued in a Claude terminal. This thread waits until claude exits there; what you do in the terminal is not shown here.",
      }).catch(() => undefined);
      return info;
    } finally {
      ctx.cli.settle(record.id, terminalId);
    }
  });
  // docs/specs/claude-sign-in.md: the CLI's own login, under the account the chat's turns use.
  handle(HARNESS_METHODS.sessionClaudeSignIn, async (p) => {
    const record = sessions.get(p.sessionId);
    if (!record?.workspaceId) throw new Error("This thread has no folder to open a terminal in.");
    const exe = await resolveClaudeExecutable();
    if (!exe) throw new Error("Claude Code was not found on this host. Install it (npm i -g @anthropic-ai/claude-code), then sign in.");
    return ctx.terminals.create({
      workspaceId: record.workspaceId,
      cwd: record.cwd,
      cols: 120,
      rows: 30,
      program: { argv: [exe, ...CLAUDE_SIGN_IN_ARGS], title: "Sign in to Claude", env: (await chatAgentLaunch("claude")).env },
    });
  });
  handle(HARNESS_METHODS.sessionConsultLead,(p) => consultRequester(ctx, p.leadSessionId, p.from, p.question));
  handle(HARNESS_METHODS.sessionAddContext, async (p) => {
    noteActivity(sessions, p.sessionId, p.text);
    return {};
  });
  handle(HARNESS_METHODS.sessionCreate, async (p) => {
    if (p.agent !== undefined && !isChatAgentId(p.agent)) throw new Error(`Unknown agent ${String(p.agent)}`);
    // A chat an agent started sits under that agent's chat, one level deep; a parent on another
    // host is kept as given, for the window that lists both.
    const requested = typeof p.parentId === "string" && p.parentId ? p.parentId : undefined;
    const parentId = requested && !p.role ? (sessions.parentFor(requested) ?? requested) : undefined;
    // MCP servers for this chat alone (docs/specs/relay-settings.md); only Claude chats take them.
    const connectors = !p.agent || p.agent === "claude" ? connectorPresets(p.connectors) : undefined;
    const record = sessions.create({
      ...(connectors ? { connectors } : {}),
      workspaceId: p.workspaceId,
      cwd: workspaceRoot(p.workspaceId),
      ...(parentId ? { parentId } : {}),
      ...(p.agent && p.agent !== "claude" ? { agent: p.agent } : {}),
      ...(p.role === "manager" ? { role: p.role, title: "Manager" } : {}),
      ...(p.role === "lead" ? { role: p.role, title: "Lead" } : {}),
      // Every agent is held to the mode the chat starts in (codex-and-acp-parity.md).
      ...(p.permissionMode && PERMISSION_MODES.has(p.permissionMode)
        ? { options: { ...DEFAULT_SESSION_OPTIONS, permissionMode: p.permissionMode } }
        : {}),
    });
    // Started now, as Orca opens a chat's session on create, so its model and mode pickers fill in.
    acpAgents.for(record)?.ensureStarted().catch((error) => log(`starting ${p.agent} failed: ${String(error)}`));
    return publicInfo(record);
  });
  handle(HARNESS_METHODS.sessionClose, async (p) => {
    pendingTurns.get(p.sessionId)?.abort();
    // Its Claude process may still be up for background tasks: they go with the chat.
    await releaseFinishedTurn(p.sessionId);
    await sessions.remove(p.sessionId);
    return {};
  });
  handle(HARNESS_METHODS.sessionRename, async (p) => {
    const session = requireSession(p.sessionId);
    const title = typeof p.title === "string" ? p.title.replace(/\s+/g, " ").trim().slice(0, 100) : "";
    if (!title) throw new Error("A chat needs a name");
    sessions.update(session.id, { title });
    return publicInfo(session);
  });
  handle(HARNESS_METHODS.sessionSetArchived, async (p) => {
    const session = requireSession(p.sessionId);
    sessions.update(session.id, { archived: p.archived === true });
    return publicInfo(session);
  });
  // A window showed the thread to the person: it can go Quiet once left alone (turn-taking-states.md).
  handle(HARNESS_METHODS.sessionMarkSeen, async (p) => {
    const session = requireSession(p.sessionId);
    sessions.update(session.id, { seenAt: Date.now() });
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
    // A Codex or ACP agent that is running takes the new mode now; one that is not, when it starts.
    if (options.permissionMode !== session.options.permissionMode) await acpAgents.for(session)?.refreshPermissionMode();
    return publicInfo(session);
  });

  handle(HARNESS_METHODS.sessionSetAgentOption, async (p) => {
    const session = requireSession(p.sessionId);
    const agent = acpAgents.for(session);
    if (!agent) throw new Error("Claude chats set options with setOptions");
    await agent.setOption(p.optionId, p.value);
    return publicInfo(session);
  });

  // The chat stays (transcript, title, place); the agent behind it is replaced. Nothing of the old
  // agent's context moves over: the new one is handed the conversation as text (agent-handoff.ts).
  handle(HARNESS_METHODS.sessionSetAgent, async (p) => {
    const session = requireSession(p.sessionId);
    if (!isChatAgentId(p.agent)) throw new Error(`Unknown agent ${String(p.agent)}`);
    const to = p.agent;
    if (to === (session.agent ?? "claude")) return publicInfo(session);
    // The agent taking over is handed another agent's conversation.
    refuseUnattended(to, "a thread another agent has worked in");
    const refuseBusy = () => {
      if (pendingTurns.has(session.id) || session.status === "working" || session.status === "needs-you") {
        throw new Error("Stop the agent, or answer what it asks, before changing this chat's agent");
      }
    };
    refuseBusy();
    // The Manager and Lead chats are Claude with the harness's own instructions and tools.
    if (session.role) throw new Error("This chat runs on Claude only");
    // A workflow step's local-only data would reach the new agent with the conversation.
    if (session.localOnly) throw new Error("This chat works with local-only data, so its agent cannot change");
    const resolved = await resolveChatAgent(to);
    if (resolved.status !== "ready") throw new Error(`${chatAgentLabel(to)} cannot run on this host: ${resolved.detail}`);
    // Claude's finished turn may still wait on its prompt suggestion, which is for Claude's next turn.
    await releaseFinishedTurn(session.id);
    const transcript = await sessions.transcript(session.id);
    // Nothing waits from here to the record's update: no turn starts on the agent being let go, and
    // a second change asked for meanwhile sees this one done.
    if (requireSession(session.id) !== session) throw new Error(`Unknown session ${session.id}`);
    refuseBusy();
    const from: ChatAgentId = session.agent ?? "claude";
    if (to === from) return publicInfo(session);
    const resumes = to === "claude" ? session.claudeSessionId !== null : !!session.agentSessionIds?.[to];
    const answered = answeredBefore(transcript, from, to);
    const notice = agentSwitchNotice(from, to, resumes && answered);
    const handoffContext = pendingHandoff([...transcript, notice], { agent: to, cwd: session.cwd, resumes });
    acpAgents.release(session.id);
    // A resume scheduled for the old agent's usage limit is not the new agent's to run.
    autoResume.disable(session.id);
    sessions.update(session.id, {
      agent: to === "claude" ? undefined : to,
      // An external agent reports its own options once its session opens; Claude chats have none of these.
      agentState: to === "claude" ? undefined : emptyAgentState(),
      handoffContext,
      promptSuggestion: null,
      // A chat an older daemon named after its agent would now carry the wrong one.
      ...(session.title === chatAgentLabel(from) ? { title: NEW_CHAT_TITLE } : {}),
      // Claude keeps the options it had in this chat; where it never answered, it starts on the defaults.
      ...(to === "claude" && !answered
        ? {
            options: {
              ...DEFAULT_SESSION_OPTIONS,
              ...(p.permissionMode && PERMISSION_MODES.has(p.permissionMode) ? { permissionMode: p.permissionMode } : {}),
            },
          }
        : to !== "claude" && p.permissionMode && PERMISSION_MODES.has(p.permissionMode)
          ? { options: { ...session.options, permissionMode: p.permissionMode } }
          : {}),
    });
    await emit(session.id, notice);
    acpAgents.for(session)?.ensureStarted().catch((error) => log(`starting ${to} failed: ${String(error)}`));
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
      // Claude took this chat back and was not told yet what it missed: a whole copy needs telling too.
      ...(!p.fromMessageId && source.handoffContext ? { handoffContext: source.handoffContext } : {}),
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
    const eras = agentEras(transcript, "claude");
    requireClaudePrompt(eras, start, "Rewinding");
    const ordinal = claudePromptsBefore(transcript, eras, start);
    const claudeSessionId = session.claudeSessionId
      ? await conversationBefore(session.claudeSessionId, session.cwd, p.messageId, ordinal)
      : null;
    const text = transcript
      .slice(start)
      .filter((u): u is UserChunk => isPrompt(u) && u.messageId === p.messageId)
      .flatMap((u) => (u.content.type === "text" ? [u.content.text] : []))
      .join("\n");
    const kept = transcript.slice(0, start);
    await sessions.replaceTranscript(session.id, kept);
    // Other agents that ran this chat after that message hold what was just dropped, and ACP cannot
    // take it back out of their conversations: they start a new one when the chat returns to them.
    const stale = new Set<string>(eras.filter((era) => era.start > start).map((era) => era.agent));
    const agentSessionIds = Object.fromEntries(Object.entries(session.agentSessionIds ?? {}).filter(([agent]) => !stale.has(agent)));
    sessions.update(session.id, {
      claudeSessionId,
      agentSessionIds,
      // The message Claude took the chat back with is gone: its next one carries what it missed again.
      handoffContext: pendingHandoff(kept, { agent: "claude", cwd: session.cwd, resumes: claudeSessionId !== null }),
    });
    return { text };
  });

  handle(HARNESS_METHODS.sessionHistory, (p) => pastConversations(ctx, p));

  handle(HARNESS_METHODS.sessionResume, async (p) => publicInfo(await importConversation(ctx, p)));

  /** A fork that ends with this prompt's exchange: everything before the next prompt. */
  async function forkThrough(source: SessionRecord, claudeSessionId: string, messageId: string): Promise<string> {
    const transcript = await sessions.transcript(source.id);
    const isPrompt = (u: acp.SessionUpdate): u is UserChunk => u.sessionUpdate === "user_message_chunk";
    const start = transcript.findIndex((u) => isPrompt(u) && u.messageId === messageId);
    if (start === -1) throw new Error("That message is not in this conversation");
    const eras = agentEras(transcript, "claude");
    requireClaudePrompt(eras, start, "Forking from a message");
    // The next prompt Claude was sent: prompts other agents answered are not in its conversation.
    const next = transcript.findIndex(
      (u, i) => i > start && isPrompt(u) && !!u.messageId && u.messageId !== messageId && eraAt(eras, i)?.agent === "claude",
    );
    const nextChunk = transcript[next];
    if (next === -1 || !nextChunk || !isPrompt(nextChunk) || !nextChunk.messageId) {
      return forkConversation(claudeSessionId, source.cwd);
    }
    const ordinal = claudePromptsBefore(transcript, eras, next);
    const fork = await conversationBefore(claudeSessionId, source.cwd, nextChunk.messageId, ordinal);
    if (!fork) throw new Error("That message is not in Claude's transcript");
    return fork;
  }

  /** ACP has no stable fork or rewind; external agents' chats go without (as in Orca). */
  function requireClaude(session: SessionRecord, action: string): void {
    if (session.agent && session.agent !== "claude") throw new Error(`${action} works in Claude chats only`);
  }

  /** In a chat that changed agents, Claude's own conversation holds only the prompts Claude was sent. */
  function requireClaudePrompt(eras: AgentEra[], index: number, action: string): void {
    const agent = eraAt(eras, index)?.agent ?? "claude";
    if (agent !== "claude") throw new Error(`${action} works for messages sent to Claude; this one went to ${chatAgentLabel(agent)}`);
  }

  function requireSession(id: string): SessionRecord {
    const session = sessions.get(id);
    if (!session) throw new Error(`Unknown session ${id}`);
    return session;
  }
}

function eraAt(eras: AgentEra[], index: number): AgentEra | undefined {
  return eras.find((era) => index >= era.start && index < era.end);
}

/** How many prompts Claude was sent before `end`: the place of the next one in Claude's own conversation. */
function claudePromptsBefore(transcript: acp.SessionUpdate[], eras: AgentEra[], end: number): number {
  const ids = new Set<string>();
  transcript.slice(0, end).forEach((u, i) => {
    if (u.sessionUpdate === "user_message_chunk" && u.messageId && eraAt(eras, i)?.agent === "claude") ids.add(u.messageId);
  });
  return ids.size;
}
