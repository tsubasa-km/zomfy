import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest, subscribeTerminalOutput } from '@/daemon-connection'
import { isLinkModifier, openHref } from '@/lib/link-routing'
import { registerFileLinks } from '@/lib/terminal-file-links'
import { getState, subscribeStore } from '@/session-store'

/**
 * How many hidden terminals keep their xterm. Showing one of these again is a DOM reattach; one
 * past the cap was disposed and replays its scrollback from the daemon when shown.
 */
export const MAX_PARKED_TERMINALS = 8

/** What the view showing a terminal handles; absent while the terminal is hidden. */
export type LiveTerminalHandlers = {
  input: (data: string) => void
  /** xterm's custom key handler: false when the view handled the key. */
  key: (event: KeyboardEvent) => boolean
  cwd: () => string
}

/**
 * One xterm with its addons, its live output subscription and the element it draws into. It
 * outlives the view that shows it: a hidden tab's terminal is parked (its element detached, so it
 * does not render) and keeps taking output, so showing the tab again needs no replay.
 */
export type LiveTerminal = {
  readonly terminalId: string
  readonly workspaceId: string
  readonly startedAt: number | undefined
  readonly xterm: Terminal
  readonly fit: FitAddon
  readonly search: SearchAddon
  readonly element: HTMLDivElement
  handlers: LiveTerminalHandlers | null
  /** The size last sent to the PTY, so showing a terminal again resizes it only when it changed. */
  ptySize: { cols: number; rows: number } | null
}

type Entry = {
  live: LiveTerminal
  /** Not kept in the cache: a second view of a terminal already shown (a chat's inline copy). */
  ephemeral: boolean
  shown: boolean
  lastShown: number
  dispose: () => void
}

const entries = new Map<string, Entry>()
const byLive = new WeakMap<LiveTerminal, Entry>()

type Options = {
  terminalId: string
  workspaceId: string
  startedAt: number | undefined
  /** The view's element; the terminal's own element goes inside it. */
  host: HTMLElement
  xtermOptions: ConstructorParameters<typeof Terminal>[0]
}

function create(options: Options, ephemeral: boolean): Entry {
  const { terminalId, workspaceId, startedAt, host } = options
  const element = document.createElement('div')
  element.style.width = '100%'
  element.style.height = '100%'
  // xterm measures its font when it opens, which needs the element in the document.
  host.appendChild(element)
  const xterm = new Terminal({
    ...options.xtermOptions,
    // The search addon's match decorations use the proposed decoration API.
    allowProposedApi: true
  })
  const fit = new FitAddon()
  const search = new SearchAddon()
  xterm.loadAddon(fit)
  xterm.loadAddon(search)
  // Same route as every other link: system browser, Mod+click to an in-app tab.
  xterm.loadAddon(new WebLinksAddon((event, uri) => openHref(uri, { inApp: isLinkModifier(event), workspaceId })))
  xterm.open(element)
  // xterm 6 draws no cursor until its first focus; an alternate-screen round trip starts it, so a
  // terminal nobody has clicked yet (a drawer's, a background split pane's) still shows one.
  xterm.write('[?1047h[?1047l')

  const live: LiveTerminal = { terminalId, workspaceId, startedAt, xterm, fit, search, element, handlers: null, ptySize: null }
  const fileLinks = registerFileLinks(xterm, terminalId, workspaceId, () => live.handlers?.cwd() ?? '')

  // Live output that arrives before the replay is written waits, so the screen stays in order.
  // Output keeps flowing in while the terminal is parked, so it is current when shown again.
  let disposed = false
  let replayed = false
  const queued: string[] = []
  const unsubscribe = subscribeTerminalOutput(terminalId, (data) => {
    if (replayed) xterm.write(data)
    else queued.push(data)
  })
  void harnessRequest(HARNESS_METHODS.terminalAttach, { terminalId })
    .then(({ buffer }) => {
      if (disposed) return
      xterm.write(buffer)
      for (const data of queued) xterm.write(data)
      queued.length = 0
      replayed = true
    })
    .catch(() => undefined)

  const input = xterm.onData((data) => live.handlers?.input(data))
  xterm.attachCustomKeyEventHandler((event) => live.handlers?.key(event) ?? true)

  const entry: Entry = {
    live,
    ephemeral,
    shown: true,
    lastShown: Date.now(),
    dispose: () => {
      if (disposed) return
      disposed = true
      unsubscribe()
      fileLinks.dispose()
      input.dispose()
      xterm.dispose()
      element.remove()
    }
  }
  byLive.set(live, entry)
  return entry
}

function drop(entry: Entry): void {
  entry.dispose()
  if (entries.get(entry.live.terminalId) === entry) entries.delete(entry.live.terminalId)
}

/** Disposes the parked terminals past the cap, least recently shown first. */
function trim(): void {
  const parked = [...entries.values()].filter((e) => !e.shown).sort((a, b) => a.lastShown - b.lastShown)
  for (const entry of parked.slice(0, Math.max(0, parked.length - MAX_PARKED_TERMINALS))) drop(entry)
}

let watching = false
let watchedTerminals: unknown = null

/** A closed terminal's parked xterm goes with it. */
function watchClosedTerminals(): void {
  if (watching) return
  watching = true
  subscribeStore(() => {
    const { terminals } = getState()
    if (terminals === watchedTerminals) return
    watchedTerminals = terminals
    const open = new Set(terminals.map((t) => t.id))
    for (const entry of [...entries.values()]) if (!entry.shown && !open.has(entry.live.terminalId)) drop(entry)
  })
}

/**
 * The xterm to show a terminal with, its element placed in `host`: the parked one when there is
 * one for this run of the shell, else a new one that replays the shell's output.
 */
export function showTerminal(options: Options): LiveTerminal {
  watchClosedTerminals()
  const kept = entries.get(options.terminalId)
  if (kept && (kept.live.startedAt !== options.startedAt || kept.live.workspaceId !== options.workspaceId)) {
    // A restart (or a move) starts the screen over.
    if (!kept.shown) drop(kept)
  } else if (kept && !kept.shown) {
    kept.shown = true
    kept.lastShown = Date.now()
    options.host.appendChild(kept.live.element)
    return kept.live
  }
  const current = entries.get(options.terminalId)
  // Shown somewhere already (a terminal tab and its chat's inline copy): this view gets its own.
  const entry = create(options, current !== undefined)
  if (!entry.ephemeral) entries.set(options.terminalId, entry)
  return entry.live
}

/** The view showing `live` went away: its xterm is parked for the next showing, or disposed. */
export function hideTerminal(live: LiveTerminal): void {
  const entry = byLive.get(live)
  if (!entry) return
  live.handlers = null
  if (entry.ephemeral || entries.get(live.terminalId) !== entry) {
    entry.dispose()
    return
  }
  entry.shown = false
  entry.lastShown = Date.now()
  live.element.remove()
  trim()
}

/** For tests and diagnostics: the terminals whose xterm is parked. */
export function parkedTerminalIds(): string[] {
  return [...entries.values()].filter((e) => !e.shown).map((e) => e.live.terminalId)
}
