# Checking the UI yourself

A change you can see on screen is done when you have looked at it, not when the tests pass. This is
how an agent (or a person) does that without touching anyone's real Zomfy.

## A preview: a private copy of the app

```sh
cd apps/desktop
bun scripts/preview.ts start <slot 1-9>   # prints its ports, then keeps running
bun scripts/preview.ts stop <slot>        # always stop it when you are done
```

A preview is the UI in headless Edge with its own daemon, state folder (`%TEMP%/zomfy-preview-<slot>`
or the OS temp dir) and a playground repository, so it never reads or writes the real
`~/.zomfy`, `~/zomfy` or another preview. Ports: daemon `7900+slot`, Vite `1430+slot`, DevTools
(CDP) `9300+slot`. Pick a slot nobody else is using; several agents can run side by side.

Not in a preview: WSL hosts and what only the Tauri shell does (native file dialogs, "Open in",
the window frame). Never use `tauri dev` to check a change; it shares the real app's state.

## Driving it

`scripts/cdp.ts` talks to a preview (or a debug build) over the DevTools protocol:

```sh
export HARNESS_CDP_PORT=9308              # 9300 + your slot (here slot 8)
bun scripts/cdp.ts screenshot out.png [WxH]
bun scripts/cdp.ts eval "<js expression>"
bun scripts/cdp.ts click "<css selector>"
bun scripts/cdp.ts type "<css selector>" "<text>"
bun scripts/cdp.ts key "Ctrl+S"
bun scripts/cdp.ts drag x1 y1 x2 y2
bun scripts/cdp.ts logs [ms]             # reload and print console output and exceptions
```

The full list is at the top of `scripts/cdp.ts`. In `eval`, the app's stores can be imported through
the module URLs Vite serves (`performance.getEntriesByType('resource')` lists them), which lets you
put the UI into a state that is hard to reach by clicking (a waiting chat, a long transcript).

## What to check

- Look at every screenshot you take: alignment, spacing, truncation, overflow, and both light and
  dark themes when colours changed.
- Check the states around the change too: empty, loading, error, one item and many.
- For startup, record it: `bun scripts/preview.ts start <slot> --prod` (a production build), then
  `bun scripts/record-startup.ts record <out-dir>` and `compare <before> <after>`; the steps are in
  [docs/specs/calm-startup.md](../../docs/specs/calm-startup.md).
- For speed, measure rather than guess: a `PerformanceObserver` for `longtask` entries in `eval`,
  timed before and after the change.
- Say in your report what you looked at and what you could not (for example a second host).
