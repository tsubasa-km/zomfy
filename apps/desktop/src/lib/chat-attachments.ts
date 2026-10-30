import { HARNESS_METHODS, type ChatAttachmentKind } from '@acp-harness/protocol'
import { ensureSessionLoaded, harnessRequest } from '@/daemon-connection'
import { requestComposerFocus } from '@/chat-actions'
import { patchChatSession } from '@/stores/chat-store'
import { getState, openEditorTab, selectTab, selectTerminal, type Session, type ThreadItem } from '@/session-store'
import { mentionText, type ChatMention } from '@/lib/chat-mentions'
import { terminalScreenText } from '@/lib/terminal-screen-text'
import { flashWhenShown } from '@/lib/flash-element'
import { toast } from 'sonner'
import { t } from '@/i18n/i18n'

/** Adds a mention to the draft after a space (not a new line), and puts the caret in the composer. */
export function insertMention(chatId: string, mention: string): void {
  patchChatSession(chatId, (c) => ({
    draft: !c.draft || /\s$/.test(c.draft) ? `${c.draft}${mention}` : `${c.draft} ${mention}`
  }))
  requestComposerFocus(chatId)
}

/** `@path` of a file in the chat's workspace, read by the agent like any @ mention. */
export function mentionFile(chat: Session, path: string): void {
  insertMention(chat.id, mentionText(path))
}

async function saveAttachment(chat: Session, kind: ChatAttachmentKind, sourceId: string, title: string, text: string) {
  const { path } = await harnessRequest(
    HARNESS_METHODS.chatAttachmentSave,
    { sessionId: chat.id, kind, sourceId, title, text },
    chat.hostId
  )
  insertMention(chat.id, mentionText(path))
}

/** A snapshot of the terminal's screen (on any host), saved on the chat's host and mentioned. */
export async function attachTerminal(chat: Session, terminalId: string): Promise<void> {
  const terminal = getState().terminals.find((t) => t.id === terminalId)
  if (!terminal) return
  await saveAttachment(chat, 'terminal', terminalId, terminal.customTitle || terminal.title, await terminalScreenText(terminalId))
}

/** A snapshot of another chat's transcript (on any host), saved on the chat's host and mentioned. */
export async function attachChat(chat: Session, sourceId: string): Promise<void> {
  if (sourceId === chat.id) return
  await ensureSessionLoaded(sourceId)
  const source = getState().sessions.find((s) => s.id === sourceId)
  if (!source) return
  await saveAttachment(chat, 'chat', sourceId, source.title, transcriptText(source))
}

/** Prompts, replies and tool calls, as a reader skimming the chat would want them. */
function transcriptText(session: Session): string {
  const lines = [`# ${session.title}`, '']
  for (const item of session.items as ThreadItem[]) {
    if (item.kind === 'user' && item.text) lines.push('## User', item.text, '')
    else if (item.kind === 'agent' && item.text) lines.push('## Assistant', item.text, '')
    else if (item.kind === 'tool') lines.push(`- tool: ${item.title} (${item.status})`)
  }
  return lines.join('\n')
}

/** Shows what a mention names (the file, the chat, or the terminal) and briefly outlines it there. */
export function openChatMention(mention: Pick<ChatMention, 'kind' | 'path' | 'sourceId'>, workspaceId: string | null): void {
  const state = getState()
  const id = CSS.escape(mention.sourceId ?? '')
  if (mention.kind === 'file') {
    if (!workspaceId) return
    openEditorTab({ workspaceId, kind: 'file', path: mention.path, staged: false })
    const tab = getState().editorTabs.find((t) => t.workspaceId === workspaceId && t.kind === 'file' && t.path === mention.path)
    if (tab) flashWhenShown(`[data-editor-tab="${CSS.escape(tab.id)}"]`)
    return
  }
  if (mention.kind === 'chat') {
    const session = state.sessions.find((s) => s.id === mention.sourceId)
    if (!session) {
      toast.info(t('That chat is closed. The message still carries its snapshot.'))
      return
    }
    selectTab(session.workspaceId, session.id)
    flashWhenShown(`[data-chat-session-id="${id}"]`)
    return
  }
  const terminal = state.terminals.find((t) => t.id === mention.sourceId)
  if (!terminal) {
    toast.info(t('That terminal is closed. The message still carries its snapshot.'))
    return
  }
  if (!terminal.inline) {
    selectTerminal(terminal.id)
    // The xterm host; its parent is the whole terminal view.
    flashWhenShown(`[data-terminal-id="${id}"]`, { pick: (el) => el.parentElement })
    return
  }
  // A Run's terminal: bring its chat forward, then its code block into view (the outline waits for the scroll).
  const chat = state.sessions.find((s) => s.id === terminal.inline?.sessionId)
  if (chat) selectTab(chat.workspaceId, chat.id)
  let scrolled = false
  flashWhenShown(`[data-native-chat-inline-terminal="${id}"]`, {
    afterMs: 400,
    pick: (el) => {
      if (!scrolled) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      scrolled = true
      return el
    }
  })
}
