import type { ManagerCallResult, TerminalInfo } from '@acp-harness/protocol'
import type { TerminalManager } from './terminal-manager.ts'
import { asksForSecret, type TerminalScreens } from './terminal-screen.ts'

// The terminal_* harness tools: a chat's agent reads and types into the terminal tabs of its
// workspace, which the person sees and can take back (TerminalManager.agentWrite). Approval is the
// agent's own: terminal_send is not read-only, so each send asks the person unless the chat's
// permission mode lets it through. What only Zomfy knows is enforced here: a password prompt's screen
// never reaches the agent, and a terminal the person took back refuses its keystrokes.

const KEYS: Record<string, string> = {
  'ctrl-c': '\x03',
  'ctrl-d': '\x04',
  escape: '\x1b',
  tab: '\t',
  up: '\x1b[A',
  down: '\x1b[B',
  enter: '\r'
}
const DEFAULT_LINES = 40
const MAX_LINES = 200
const POLL_MS = 150

export interface TerminalToolDeps {
  terminals: Pick<TerminalManager, 'list' | 'get' | 'agentWrite' | 'onPersonInput'>
  screens: Pick<TerminalScreens, 'read' | 'lastOutputAt'>
  /** The calling chat's workspace and title; null for an unknown chat. */
  chat: (sessionId: string) => { workspaceId: string; title: string } | null
}

const ok = (result: string): ManagerCallResult => ({ result })
const fail = (result: string): ManagerCallResult => ({ result, isError: true })

function describe(info: TerminalInfo): string {
  const what = info.connection
    ? `SSH login "${info.connection.name}"${info.connection.tag ? `, ${info.connection.tag} server` : ''}`
    : `local ${info.agent ? `${info.agent} agent` : 'shell'}`
  const state = info.exitCode !== null ? `exited (${info.exitCode})` : 'running'
  const control =
    info.agentControl?.state === 'held'
      ? '; the person took it back, so you may not type until they hand it back'
      : info.agentControl?.state === 'driving'
        ? `; typed into lately by "${info.agentControl.chatTitle}"`
        : ''
  return `${info.id}  "${info.title}"  ${what}, ${state}${control}`
}

function caution(info: TerminalInfo): string {
  return info.connection?.tag === 'production'
    ? 'This is a production server. Before anything that changes it, tell the person what you will run and why.\n'
    : ''
}

export function createTerminalTools(deps: TerminalToolDeps) {
  /** The terminal, if it is one of the caller's workspace's tabs. */
  const terminalFor = (caller: string, args: Record<string, unknown>): { info: TerminalInfo; chat: { workspaceId: string; title: string } } | string => {
    const chat = deps.chat(caller)
    if (!chat) return 'Unknown chat.'
    const id = typeof args.terminalId === 'string' ? args.terminalId : ''
    const info = deps.terminals.list().find((t) => t.id === id)
    if (!info || info.workspaceId !== chat.workspaceId || info.inline) return `No terminal ${id || '(none given)'} in your workspace; terminal_list shows them.`
    return { info, chat }
  }

  const screenOf = async (info: TerminalInfo, lines: number): Promise<{ text: string; secret: boolean }> => {
    const screen = await deps.screens.read(info.id, lines)
    if (asksForSecret(screen.cursorLine)) {
      return { text: `The terminal is asking for a password or code ("${screen.cursorLine.trim()}"). Its screen is withheld; ask the person to type it.`, secret: true }
    }
    return { text: screen.lines.join('\n'), secret: false }
  }

  const render = async (info: TerminalInfo, lines: number, note = ''): Promise<string> => {
    const { text, secret } = await screenOf(info, lines)
    return `${note}${describe(deps.terminals.get(info.id))}\n${caution(info)}${secret ? text : `--- last ${lines} lines ---\n${text}`}`
  }

  return {
    list(caller: string): ManagerCallResult {
      const chat = deps.chat(caller)
      if (!chat) return fail('Unknown chat.')
      const mine = deps.terminals.list().filter((t) => t.workspaceId === chat.workspaceId && !t.inline)
      if (mine.length === 0) return ok('No terminal tabs are open in your workspace. Ask the person to open one (a shell, or a saved SSH login from the + menu).')
      return ok(mine.map(describe).join('\n'))
    },

    async read(caller: string, args: Record<string, unknown>): Promise<ManagerCallResult> {
      const found = terminalFor(caller, args)
      if (typeof found === 'string') return fail(found)
      const lines = Math.min(MAX_LINES, Math.max(1, Math.floor(Number(args.lines) || DEFAULT_LINES)))
      return ok(await render(found.info, lines))
    },

    async send(caller: string, args: Record<string, unknown>): Promise<ManagerCallResult> {
      const found = terminalFor(caller, args)
      if (typeof found === 'string') return fail(found)
      const key = typeof args.key === 'string' ? KEYS[args.key] : undefined
      const text = typeof args.text === 'string' ? args.text : ''
      if (args.key !== undefined && !key) return fail(`Unknown key ${String(args.key)}.`)
      if (!key && !text) return fail('Give the text to type, or a key.')
      if (!key && (await screenOf(found.info, 1)).secret) return fail('The terminal is asking for a password or code: only the person types those.')
      const data = key ?? `${text.replace(/\r?\n/g, '\r')}${args.enter === false ? '' : '\r'}`
      try {
        deps.terminals.agentWrite(found.info.id, data, { sessionId: caller, chatTitle: found.chat.title })
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error))
      }
      return ok('Sent; the person sees it. Read the result with terminal_wait.')
    },

    async wait(caller: string, args: Record<string, unknown>): Promise<ManagerCallResult> {
      const found = terminalFor(caller, args)
      if (typeof found === 'string') return fail(found)
      const id = found.info.id
      const want = typeof args.text === 'string' && args.text ? args.text : null
      const quietMs = Math.max(200, Number(args.quietMs) || 1500)
      const timeoutMs = Math.min(300, Math.max(1, Number(args.timeoutSeconds) || 30)) * 1000
      const start = Date.now()
      let personTyped = false
      const stop = deps.terminals.onPersonInput((terminalId) => {
        if (terminalId === id) personTyped = true
      })
      try {
        let why = 'Timed out.'
        for (;;) {
          await Bun.sleep(POLL_MS)
          const info = deps.terminals.get(id)
          if (personTyped) {
            why = 'The person typed into the terminal, so the wait ended early.'
            break
          }
          if (info.exitCode !== null) {
            why = `The terminal exited (${info.exitCode}).`
            break
          }
          if (want) {
            if ((await deps.screens.read(id, MAX_LINES)).lines.some((line) => line.includes(want))) {
              why = ''
              break
            }
          } else if (Date.now() - Math.max(start, deps.screens.lastOutputAt(id)) >= quietMs) {
            why = ''
            break
          }
          if (Date.now() - start >= timeoutMs) break
        }
        return ok(await render(deps.terminals.get(id), DEFAULT_LINES, why ? `${why}\n` : ''))
      } finally {
        stop()
      }
    }
  }
}
