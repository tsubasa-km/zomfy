import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { tuiAgentSpec, type CreateTerminalParams, type ShellOption, type TerminalInfo, type TerminalShellKind } from '@acp-harness/protocol'
import { log } from './log.ts'
import { forgetInlineTerminal, loadInlineTerminals, saveInlineTerminal, type SavedInlineTerminal } from './inline-terminal-store.ts'
import { OscScanner } from './terminal-osc.ts'
import { buildAgentLaunchPlan } from './tui-agent-launch.ts'
import { hostPath } from './tui-agent-detection.ts'

/** Enough scrollback for a reloaded window to repaint a busy screen. */
const REPLAY_LIMIT = 256 * 1024
/** Output is batched so a chatty program does not send one notification per read. */
const FLUSH_MS = 8
/** Title changes are coalesced; spinners in agent titles repaint many times a second. */
const TITLE_NOTIFY_MS = 150
/** An inline terminal's screen is saved this long after its output settles. */
const INLINE_SAVE_MS = 1000

interface ShellSpec extends ShellOption {
  argv: string[]
  kind: TerminalShellKind
  env?: Record<string, string>
}

interface LiveTerminal {
  info: TerminalInfo
  spec: ShellSpec
  pty: Bun.Terminal
  proc: Bun.Subprocess
  replay: string
  pending: string
  flushTimer: ReturnType<typeof setTimeout> | null
  osc: OscScanner
  oscTitle: string | null
  oscTitleIsProgram: boolean
  /** Reads so far and when the last one arrived, for the startup typing below. */
  reads: number
  lastReadAt: number
  cols: number
  rows: number
}

type CreateParams = CreateTerminalParams & {
  cwd: string
  /** A program to run instead of a shell (setup scripts); the tab keeps its output after exit. */
  program?: { argv: string[]; title: string; env?: Record<string, string> }
}

export class TerminalManager {
  private readonly terminals = new Map<string, LiveTerminal>()
  private readonly shells = detectShells()
  private readonly changeListeners = new Set<(list: TerminalInfo[]) => void>()
  private readonly outputListeners = new Set<(terminalId: string, data: string) => void>()
  private titleTimer: ReturnType<typeof setTimeout> | null = null
  /** Inline terminals from before this host last stopped: their output only, no process. */
  private readonly ended = new Map<string, SavedInlineTerminal>()
  private readonly saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /** `chatExists` tells restored inline terminals whose chat is gone. */
  constructor(private readonly chatExists: (sessionId: string) => boolean = () => true) {
    void this.restoreInline()
  }

  onChange(listener: (list: TerminalInfo[]) => void): void {
    this.changeListeners.add(listener)
  }

  onOutput(listener: (terminalId: string, data: string) => void): void {
    this.outputListeners.add(listener)
  }

  listShells(): ShellOption[] {
    return this.shells.map(({ id, label }) => ({ id, label }))
  }

  list(): TerminalInfo[] {
    return [...[...this.terminals.values()].map((t) => t.info), ...[...this.ended.values()].map((t) => t.info)]
  }

  get(terminalId: string): TerminalInfo {
    return this.ended.get(terminalId)?.info ?? this.require(terminalId).info
  }

  async create(params: CreateParams): Promise<TerminalInfo> {
    const spec: ShellSpec | undefined = params.program
      ? {
          id: 'program',
          label: params.program.title,
          argv: params.program.argv,
          // Hook runners are .cmd files on Windows unless they start with #!.
          kind: process.platform === 'win32' && /.cmd$/i.test(params.program.argv.at(-1) ?? '') ? 'cmd' : 'posix',
          env: params.program.env
        }
      : (this.shells.find((s) => s.id === params.shellId) ?? this.shells[0])
    if (!spec) throw new Error('No shell found on this host')
    const now = Date.now()
    const info: TerminalInfo = {
      id: crypto.randomUUID(),
      workspaceId: params.workspaceId,
      title: spec.label,
      shell: spec.argv[0]!,
      shellId: spec.id,
      shellKind: spec.kind,
      cwd: params.cwd,
      createdAt: now,
      startedAt: now,
      exitCode: null,
      agent: params.agent ?? null,
      customTitle: null,
      inline: params.inline ?? null
    }
    // Built before spawning so a bad agent id fails the request instead of leaving a stray shell.
    const plan = params.agent ? buildAgentLaunchPlan(params.agent, params.prompt, spec.kind) : null
    const live = await this.spawn(info, spec, params.cols, params.rows)
    log(`terminal ${info.id} (${spec.label}${params.agent ? `, ${params.agent}` : ''}) in ${params.cwd}`)
    this.changed()
    this.saveInlineSoon(info.id)
    const typed = plan ? `${plan.command}\r` : params.command
    if (typed) void this.typeStartup(live, typed, plan?.followupPrompt ?? null)
    return live.info
  }

  /** Starts the shell again in the same tab; an agent tab relaunches its agent without the old prompt. */
  async restart(terminalId: string): Promise<TerminalInfo> {
    const ended = this.ended.get(terminalId)
    if (ended) {
      // A fresh shell where the restored output was; the code block's Run types its command again.
      const spec = this.shells.find((s) => s.id === ended.info.shellId) ?? this.shells[0]
      if (!spec) throw new Error('No shell found on this host')
      this.ended.delete(terminalId)
      const next = await this.spawn({ ...ended.info, exitCode: null, endedWithHost: false, startedAt: Date.now() }, spec, 120, 30)
      this.changed()
      this.saveInlineSoon(terminalId)
      return next.info
    }
    const live = this.require(terminalId)
    const { cols, rows } = live
    this.stop(live)
    const info: TerminalInfo = { ...live.info, exitCode: null, startedAt: Date.now() }
    const next = await this.spawn(info, live.spec, cols, rows)
    this.changed()
    if (info.agent) void this.typeStartup(next, `${buildAgentLaunchPlan(info.agent, undefined, live.spec.kind).command}\r`, null)
    return next.info
  }

  rename(terminalId: string, title: string | null): TerminalInfo {
    const ended = this.ended.get(terminalId)
    if (ended) return this.updateEnded(ended, { customTitle: title?.trim() || null, title: title?.trim() || ended.info.title })
    const live = this.require(terminalId)
    live.info = { ...live.info, customTitle: title?.trim() || null }
    this.refreshTitle(live)
    this.changed()
    return live.info
  }

  setInline(terminalId: string, inline: TerminalInfo['inline']): TerminalInfo {
    const ended = this.ended.get(terminalId)
    if (ended) return this.updateEnded(ended, { inline: inline ?? null })
    const live = this.require(terminalId)
    live.info = { ...live.info, inline: inline ?? null }
    this.changed()
    this.saveInlineSoon(terminalId)
    return live.info
  }

  replay(terminalId: string): string {
    const ended = this.ended.get(terminalId)
    if (ended) return ended.replay
    const live = this.require(terminalId)
    return live.replay + live.pending
  }

  write(terminalId: string, data: string): void {
    if (this.ended.has(terminalId)) return
    const live = this.require(terminalId)
    if (live.info.exitCode === null) live.pty.write(data)
  }

  resize(terminalId: string, cols: number, rows: number): void {
    if (this.ended.has(terminalId)) return
    const live = this.require(terminalId)
    live.cols = Math.max(2, cols)
    live.rows = Math.max(2, rows)
    if (live.info.exitCode === null) live.pty.resize(live.cols, live.rows)
  }

  close(terminalId: string): void {
    clearTimeout(this.saveTimers.get(terminalId))
    this.saveTimers.delete(terminalId)
    void forgetInlineTerminal(terminalId).catch(() => undefined)
    if (this.ended.delete(terminalId)) {
      this.changed()
      return
    }
    const live = this.terminals.get(terminalId)
    if (!live) return
    this.stop(live)
    this.terminals.delete(terminalId)
    this.changed()
  }

  /** Terminals of a workspace that no longer exists. */
  closeWorkspace(workspaceId: string): void {
    for (const t of this.list()) if (t.workspaceId === workspaceId) this.close(t.id)
  }

  /** Running shells' pids and their workspaces, for attributing listening ports. */
  shellPids(): Map<number, string> {
    const pids = new Map<number, string>()
    for (const t of this.terminals.values()) if (t.info.exitCode === null) pids.set(t.proc.pid, t.info.workspaceId)
    return pids
  }

  private async spawn(info: TerminalInfo, spec: ShellSpec, cols: number, rows: number): Promise<LiveTerminal> {
    const PATH = await hostPath()
    const decoder = new TextDecoder()
    cols = Math.max(2, cols)
    rows = Math.max(2, rows)
    const pty = new Bun.Terminal({
      cols,
      rows,
      data: (_terminal, bytes) => this.push(info.id, decoder.decode(bytes, { stream: true }))
    })
    const proc = Bun.spawn(spec.argv, {
      cwd: info.cwd,
      terminal: pty,
      env: { ...envWithoutPath(), PATH, ...spec.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      // Typed only on the non-terminal overloads; ConPTY children still need it to stay hidden.
      ...({ windowsHide: true } as object)
    })
    const live: LiveTerminal = {
      info,
      spec,
      pty,
      proc,
      replay: '',
      pending: '',
      flushTimer: null,
      osc: new OscScanner(),
      oscTitle: null,
      oscTitleIsProgram: false,
      reads: 0,
      lastReadAt: 0,
      cols,
      rows
    }
    this.refreshTitle(live)
    this.terminals.set(info.id, live)
    void proc.exited.then((code) => {
      // A restart already replaced this process.
      if (this.terminals.get(info.id)?.proc !== proc) return
      this.flush(live)
      live.info = { ...live.info, exitCode: code ?? 0 }
      pty.close()
      this.changed()
      this.saveInlineSoon(info.id)
    })
    return live
  }

  private stop(live: LiveTerminal): void {
    if (live.flushTimer) clearTimeout(live.flushTimer)
    if (live.info.exitCode === null) live.proc.kill()
    live.pty.close()
  }

  /**
   * Types a launch line once the shell has drawn its prompt, as Orca queues an agent's startup
   * command into the shell it spawned; a prompt the CLI cannot take as an argument is pasted
   * after the agent's own screen settles.
   */
  private async typeStartup(live: LiveTerminal, typed: string, followupPrompt: string | null): Promise<void> {
    await this.waitForQuiet(live, 0, 300, 5_000)
    if (!this.isCurrent(live)) return
    const before = live.reads
    live.pty.write(typed)
    if (!followupPrompt) return
    await this.waitForQuiet(live, before + 1, 1_500, 20_000)
    if (!this.isCurrent(live)) return
    const screen = live.replay + live.pending
    const bracketed = screen.lastIndexOf('\x1b[?2004h') > screen.lastIndexOf('\x1b[?2004l')
    live.pty.write(bracketed ? `\x1b[200~${followupPrompt}\x1b[201~` : followupPrompt.replace(/\r?\n/g, ' '))
    await Bun.sleep(300)
    if (this.isCurrent(live)) live.pty.write('\r')
  }

  /** Resolves once more than `afterReads` reads arrived and output then stayed quiet for `quietMs`. */
  private async waitForQuiet(live: LiveTerminal, afterReads: number, quietMs: number, maxMs: number): Promise<void> {
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline && this.isCurrent(live)) {
      if (live.reads > afterReads && Date.now() - live.lastReadAt >= quietMs) return
      await Bun.sleep(50)
    }
  }

  private isCurrent(live: LiveTerminal): boolean {
    return this.terminals.get(live.info.id) === live && live.info.exitCode === null
  }

  private push(terminalId: string, data: string): void {
    const live = this.terminals.get(terminalId)
    if (!live || !data) return
    live.reads += 1
    live.lastReadAt = Date.now()
    const facts = live.osc.scan(data)
    if (facts.title !== undefined || facts.cwd !== undefined) {
      if (facts.title !== undefined) {
        live.oscTitle = displayTitle(facts.title)
        live.oscTitleIsProgram = isProgramPath(facts.title)
      }
      if (facts.cwd !== undefined) live.info = { ...live.info, cwd: facts.cwd }
      if (this.refreshTitle(live) || facts.cwd !== undefined) this.titleChanged()
    }
    live.pending += data
    live.flushTimer ??= setTimeout(() => this.flush(live), FLUSH_MS)
  }

  /** Recomputes the shown title; true when it changed. */
  private refreshTitle(live: LiveTerminal): boolean {
    // An agent tab keeps the agent's name over ConPTY's program-path title.
    const agent = live.info.agent ? (tuiAgentSpec(live.info.agent)?.label ?? null) : null
    const osc = agent && live.oscTitleIsProgram ? null : live.oscTitle
    const title = live.info.customTitle || osc || agent || live.spec.label
    if (title === live.info.title) return false
    live.info = { ...live.info, title }
    return true
  }

  private titleChanged(): void {
    this.titleTimer ??= setTimeout(() => {
      this.titleTimer = null
      this.changed()
    }, TITLE_NOTIFY_MS)
  }

  private flush(live: LiveTerminal): void {
    if (live.flushTimer) clearTimeout(live.flushTimer)
    live.flushTimer = null
    if (!live.pending) return
    const data = live.pending
    live.pending = ''
    live.replay = (live.replay + data).slice(-REPLAY_LIMIT)
    for (const listener of this.outputListeners) listener(live.info.id, data)
    this.saveInlineSoon(live.info.id)
  }

  /**
   * Keeps an inline terminal's info and screen on disk (debounced), so after the host restarts its
   * code block still shows what ran; a terminal that left its block (a tab now) is forgotten.
   */
  private saveInlineSoon(terminalId: string): void {
    clearTimeout(this.saveTimers.get(terminalId))
    this.saveTimers.set(
      terminalId,
      setTimeout(() => {
        this.saveTimers.delete(terminalId)
        const live = this.terminals.get(terminalId)
        if (!live) return
        const saved = live.info.inline
          ? saveInlineTerminal({ info: live.info, replay: live.replay + live.pending })
          : forgetInlineTerminal(terminalId)
        void saved.catch((error) => log(`inline terminal ${terminalId} not saved: ${error}`))
      }, INLINE_SAVE_MS)
    )
  }

  private updateEnded(ended: SavedInlineTerminal, patch: Partial<TerminalInfo>): TerminalInfo {
    ended.info = { ...ended.info, ...patch }
    this.changed()
    const saved = ended.info.inline ? saveInlineTerminal(ended) : forgetInlineTerminal(ended.info.id)
    void saved.catch(() => undefined)
    return ended.info
  }

  private async restoreInline(): Promise<void> {
    const saved = await loadInlineTerminals()
    for (const { info, replay } of saved) {
      if (this.terminals.has(info.id)) continue
      if (info.inline && !this.chatExists(info.inline.sessionId)) {
        void forgetInlineTerminal(info.id).catch(() => undefined)
        continue
      }
      // Still running when the host stopped: it ended with the host, not on its own.
      const endedWithHost = info.exitCode === null || info.endedWithHost === true
      this.ended.set(info.id, { info: { ...info, exitCode: info.exitCode ?? -1, endedWithHost }, replay })
    }
    if (saved.length > 0) this.changed()
  }

  private require(terminalId: string): LiveTerminal {
    const live = this.terminals.get(terminalId)
    if (!live) throw new Error(`Unknown terminal ${terminalId}`)
    return live
  }

  private changed(): void {
    const list = this.list()
    for (const listener of this.changeListeners) listener(list)
  }
}

/** Windows spells it `Path`; one key, so the merged PATH is the one the shell sees. */
function envWithoutPath(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'))
}

/** ConPTY titles a console with its program's full path; the file name is what a tab can show. */
function displayTitle(raw: string): string | null {
  const title = raw.trim()
  if (!title) return null
  return isProgramPath(title) ? basename(title.replaceAll('\\', '/')) : title
}

function isProgramPath(title: string): boolean {
  return /^[A-Za-z]:\\.*\.exe$/i.test(title.trim())
}

function detectShells(): ShellSpec[] {
  if (process.platform === 'win32') {
    const shells: ShellSpec[] = []
    const pwsh = Bun.which('pwsh')
    if (pwsh) shells.push({ id: 'pwsh', label: 'PowerShell 7', argv: [pwsh, '-NoLogo'], kind: 'powershell' })
    shells.push({ id: 'powershell', label: 'Windows PowerShell', argv: ['powershell.exe', '-NoLogo'], kind: 'powershell' })
    shells.push({ id: 'cmd', label: 'Command Prompt', argv: ['cmd.exe'], kind: 'cmd' })
    const gitBash = ['C:\\Program Files\\Git\\bin\\bash.exe'].find((p) => existsSync(p))
    if (gitBash) shells.push({ id: 'git-bash', label: 'Git Bash', argv: [gitBash, '--login', '-i'], kind: 'posix' })
    return shells
  }
  const login = process.env.SHELL || '/bin/bash'
  // The PTY must become the shell's controlling terminal, or bash runs without job control and
  // Ctrl+C never reaches the foreground program; util-linux setsid -c does exactly that.
  const setsid = Bun.which('setsid')
  const argv = setsid ? [setsid, '-c', login, '-l'] : [login, '-l']
  return [{ id: 'login', label: login.split('/').at(-1) ?? 'shell', argv, kind: 'posix' }]
}
