---
type: Spec
title: Point at the UI instead of describing it - the dev feedback overlay
description: In the Vite dev server only, a floating toggle enters feedback mode, where the person pins elements and draws over the page with a comment each, and Send saves a screenshot with the marks, feedback.md and feedback.json to %TEMP%/zomfy-feedback/<timestamp>/ and copies a short summary with the folder path.
status: stable
x-zomfy-implementation: in-progress
tags: [desktop, dev, agents, feedback]
generated: { by: "claude-code/opus-5.5", at: "2026-11-27T00:00:00Z" }
---

# Problem

When the person develops Zomfy with agents, they explain what is wrong on screen in words ("the
dot left of the second row is too low"). The agent guesses which element is meant and often guesses
wrong. Pointing at the element, or drawing on the page, says it at once; the agent then needs the
element's selector, its React component and source file:line, and a picture.

# Who it is for

The person (and agents) running the app from the Vite dev server: `bun run dev`, a debug build that
loads the dev server, or a preview (`scripts/preview.ts`). Never a production build.

# What it does

## The toggle

A small round button floats at the bottom-left corner of the window. Clicking it enters **feedback
mode**: a thin accent frame lines the viewport (the mode is on) and a toolbar opens from the
button. Clicking it again, or Escape with no comment open, leaves the mode; pins and drawings stay
until they are sent or cleared, so the person can use the app in between.

The toolbar holds icon buttons, each with a tooltip and an accessible name:

| Icon | Does |
|---|---|
| Pointer | **Select** (default tool): hover outlines the element under the pointer with its component name in a small tag; a click pins it |
| Pen | **Draw** freehand |
| Arrow | **Arrow** from press to release |
| Square | **Rectangle** from press to release |
| Trash | Clear all pins and drawings |
| Send | Send the bundle |

The active tool's button is filled. While a tool is active, the page under the overlay does not
receive clicks; the wheel still scrolls the scrollable area under the pointer.

## Pins and drawings

- Each click in Select adds a numbered pin at the element's top-left corner and an outline around
  it; pins follow their element while the layout moves. Several elements can be pinned.
- Each finished stroke, arrow or rectangle gets the next number at its end point.
- Pins and drawings share one numbering (1, 2, 3 ...) so the person can refer to them in chat.
- A new mark opens its comment box (a small text area beside the mark, focused). One box is open
  at a time; clicking a mark's number opens its box again. Enter (without Shift) or a click
  elsewhere closes it; the box's × removes the mark.

## Send

Send produces one bundle:

1. A PNG screenshot of the viewport with the pins and drawings on it (the toolbar and comment boxes
   are left out).
2. `feedback.json` and `feedback.md`: for each pin its number, comment, CSS selector, React
   component name and owner stack with source `file:line`, the element's text (trimmed), its
   bounding box, a few computed styles; for each drawing its number, kind, comment and coordinates
   (points for a stroke, start and end for an arrow, the box for a rectangle); and the page state:
   URL, document title, theme, viewport size and device pixel ratio, window role, the selected tabs
   (`[role=tab][aria-selected=true]`) and the focused element.

The overlay posts it to the dev server, which writes it to
`<os temp>/zomfy-feedback/<timestamp>/` (`screenshot.png`, `feedback.md`, `feedback.json`) and
answers with the folder. Source paths are written relative to the repository root
(`apps/desktop/src/...`). The overlay copies a short Markdown summary to the clipboard (folder path,
then one line per mark: number, component, `file:line`, comment) to paste into the chat with the
lead agent.

Confirmation is visual: the Send button turns into a green check for a moment and the marks clear.
A failed send keeps the marks, turns the button red and shows the error message beside the toolbar.

## Production

None of it reaches a production build: the overlay is a dynamic import behind
`import.meta.env.DEV` in `main.tsx`, and the endpoint is a Vite plugin with `apply: "serve"`. The
check is that `bun run build` output contains none of the overlay's identifiers (`zomfy-feedback`,
`react-grab`, `modern-screenshot`, `perfect-freehand`).

# Libraries

Researched: agentation, react-grab, stagewise toolbar, code-inspector-plugin / react-dev-inspector,
click-to-component, html-to-image and modern-screenshot, perfect-freehand.

- **react-grab (`react-grab/primitives`)** for hit testing, the selector, the component name, the
  owner stack with source file:line and the computed styles. React 19 dropped `_debugSource`;
  react-grab reads `_debugStack` through bippy and maps it back through Vite's source maps, so it
  needs no compile-time transform. code-inspector-plugin / react-dev-inspector would add a
  `data-*` attribute to every DOM element through a JSX transform; with `@vitejs/plugin-react` 6
  (no Babel) that is a second transform for one source location, where react-grab gives the whole
  component stack.
- **modern-screenshot** for the capture: maintained successor of html-to-image's approach (DOM to
  SVG foreignObject to canvas), handles canvases (xterm, Monaco) and a node filter, so the toolbar
  stays out of the picture.
- **perfect-freehand** for the pen stroke's outline.
- **Not agentation**: it is the closest tool (click to annotate, Markdown output) but ships its own
  toolbar and design, has no drawing and no screenshot, and sends to its own MCP server rather than
  writing files an agent reads. **Not stagewise**: it is an agent-in-the-browser product with its
  own CLI and agent connection, more than this needs.

The overlay's UI (toggle, toolbar, pins, drawing layer, comment boxes) is Zomfy's own, built with
the app's tokens so it follows light and dark.

# Not in scope

- Production builds and the installed app.
- Sending the bundle straight into a chat; the person pastes the summary.
- Editing or moving a mark after it is made (remove it and make it again).
- Pop-out windows other than the one the overlay runs in; each window has its own overlay.

# Acceptance

- In a preview, two pins and an arrow, each with a comment, then Send, write a folder under
  `%TEMP%/zomfy-feedback/` whose `screenshot.png` shows the two pins and the arrow, and whose
  `feedback.md` names each pinned element's component and `apps/desktop/src/...:line`.
- The summary on the clipboard holds the folder path and the three comments.
- The overlay looks right in light and dark.
- `bun run build` in `apps/desktop` produces a `dist` with no trace of the overlay.
