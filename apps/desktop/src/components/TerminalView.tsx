import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { HARNESS_METHODS, type TerminalInfo } from '@acp-harness/protocol'
import { harnessRequest, subscribeTerminalOutput } from '@/daemon-connection'
import { currentTerminalTheme } from '@/lib/terminal-themes'
import '@xterm/xterm/css/xterm.css'

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** One shell from the daemon, drawn with xterm.js as Orca's terminal panes are. */
export function TerminalView({ terminal }: { terminal: TerminalInfo }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: cssVar('--font-mono') || 'Cascadia Code, Consolas, monospace',
      scrollback: 10_000,
      theme: currentTerminalTheme()
    })
    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.loadAddon(new WebLinksAddon())
    xterm.open(element)

    // Live output that arrives before the replay is written waits, so the screen stays in order.
    let replayed = false
    const queued: string[] = []
    const unsubscribe = subscribeTerminalOutput(terminal.id, (data) => {
      if (replayed) xterm.write(data)
      else queued.push(data)
    })
    void harnessRequest(HARNESS_METHODS.terminalAttach, { terminalId: terminal.id }).then(({ buffer }) => {
      xterm.write(buffer)
      for (const data of queued) xterm.write(data)
      queued.length = 0
      replayed = true
    })

    const input = xterm.onData((data) => {
      void harnessRequest(HARNESS_METHODS.terminalInput, { terminalId: terminal.id, data })
    })

    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return
      fit.fit()
      clearTimeout(resizeTimer)
      // The PTY resize is debounced; xterm itself reflows on every frame.
      resizeTimer = setTimeout(() => {
        void harnessRequest(HARNESS_METHODS.terminalResize, {
          terminalId: terminal.id,
          cols: xterm.cols,
          rows: xterm.rows
        })
      }, 80)
    })
    observer.observe(element)
    xterm.focus()

    // Follow the OS light/dark switch the app theme already tracks.
    const themeObserver = new MutationObserver(() => (xterm.options.theme = currentTerminalTheme()))
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    return () => {
      clearTimeout(resizeTimer)
      observer.disconnect()
      themeObserver.disconnect()
      input.dispose()
      unsubscribe()
      xterm.dispose()
    }
  }, [terminal.id])

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      style={{ background: currentTerminalTheme().background }}
    >
      <div ref={host} data-terminal-id={terminal.id} className="min-h-0 flex-1 px-3 pt-2" />
      {terminal.exitCode !== null && (
        <div className="shrink-0 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          Process exited with code {terminal.exitCode}
        </div>
      )}
    </div>
  )
}
