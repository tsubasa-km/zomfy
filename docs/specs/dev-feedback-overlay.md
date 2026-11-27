---
type: Spec
title: Point at the UI instead of describing it - the dev feedback overlay
description: In the Vite dev server only, a floating toggle enters feedback mode, where the person pins elements and draws over the page with a comment each, and Send saves a screenshot with the marks, feedback.md and feedback.json to %TEMP%/zomfy-feedback/<timestamp>/ and copies a short summary with the folder path.
status: stable
x-zomfy-implementation: done
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

A small round button floats at the middle of the window's right edge, where no control of the app sits. Clicking it enters **feedback
mode**: a thin accent frame lines the viewport (the mode is on) and a toolbar opens from the
button, downwards. Clicking it again, or Escape with no comment open, leaves the mode; pins and drawings stay
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

**Ctrl+Shift+.** (Cmd+Shift+. on macOS, matched by key position) toggles the mode from anywhere,
also while a dialog or menu has the focus; no app keybinding uses it.

## Over dialogs, menus and popovers

The person often wants to point at an open dialog, dropdown menu, context menu, popover or the "+"
quick pick, so the overlay works on top of them and leaves them open:

- Its layers sit above every app layer (z-index near the maximum, in a root of its own at the end
  of `body`) with `pointer-events: auto`, since a Radix modal sets `pointer-events: none` on the
  body; it takes back `inert` or `aria-hidden` if a modal sets them on it.
- Pointer and focus events from the overlay stop at its root, so Radix's document listeners never
  see a click or focus "outside" the layer: the dialog or menu stays open and its focus trap does
  not pull the focus back, and typing in a comment box works while a dialog is open. Focus leaving
  a dialog for the overlay is kept from Radix by a capture listener on the window.
- Selecting hit-tests with `elementsFromPoint`, skipping the overlay's own nodes and lifting the
  body's `pointer-events: none` for the moment of the test, so elements inside the open layer (and
  around it) can be picked.
- Escape in feedback mode is taken on the window's capture phase, before Radix's listener on the
  document: it closes the comment or leaves the mode, never the dialog underneath.
- The screenshot is the page as it is on screen, the open layer included.

## Pins and drawings

- Each click in Select adds a numbered pin at the element's top-left corner and an outline around
  it; pins follow their element while the layout moves. Several elements can be pinned.
- Each finished stroke, arrow or rectangle gets the next number at its start (a rectangle: its
  top-left corner), so the arrow head stays visible.
- Pins and drawings share one numbering (1, 2, 3 ...) so the person can refer to them in chat.
- A new mark opens its comment box (a small text area beside the mark, focused). One box is open
  at a time; clicking a mark's number opens its box again. Enter (without Shift) or a click
  elsewhere closes it; the box's × removes the mark.

## Marks on several screens

The person often marks one screen, moves on (opens the "+" quick pick, closes it, opens Settings)
and marks the next before sending, so one screenshot at send time is not enough:

- **A shot per view.** When a mark is made, the overlay takes a screenshot of the viewport with that
  mark drawn. Marks made while the screen stays the same (one *view*) share one shot, retaken with
  each new mark so it holds them all; a different screen starts a new view. Two moments are one
  view when the URL and the open layers (dialogs, menus, listboxes, popovers) are the same and at
  least three quarters of a grid of points over the viewport hit the same elements.
- **Marks belong to their view.** A drawing shows only while its view is on screen; a pin only
  while its element can be seen: on the page, in the viewport, not hidden, and not covered by
  another screen (Settings keeps the thread view in the DOM under it). So no mark is ever drawn
  over a screen it was not made on.
- **A crop per pin.** Each pinned element gets a small image cut from its shot: its box and a 24 px
  margin, with the pin on it.
- A pin's module paths are read when it is made, so its `file:line` keeps its directory after the
  element leaves the page.

## Send

Send produces one bundle:

1. `screenshot-<n>.png`, one per view with marks, numbered in the order the views were first marked;
   `screenshot.png`, the overview: the screen at send time with only the marks that belong on it;
   and `element-<n>.png`, the crop of each pin (the toolbar and comment boxes are left out of all).
2. `feedback.json` and `feedback.md`: for each pin its number, comment, CSS selector, React
   component name and owner stack with source `file:line`, the element's text (trimmed), its
   bounding box, a few computed styles; for each drawing its number, kind, comment and coordinates
   (points for a stroke, start and end for an arrow, the box for a rectangle); and the page state:
   URL, document title, theme, viewport size and device pixel ratio, window role, the selected tabs
   (`[role=tab][aria-selected=true]`) and the focused element.

The overlay posts it to the dev server, which writes it to
`<os temp>/zomfy-feedback/<timestamp>/` and answers with the folder. `feedback.md` lists the
screenshots with the marks each holds, and gives every mark its shot (and crop), noting the marks
also on the overview. Source paths are written relative to the repository root
(`apps/desktop/src/...`). The overlay copies a short Markdown summary to the clipboard (folder path,
then one line per mark: number, component, `file:line`, comment) to paste into the chat with the
lead agent.

Confirmation is visual: the Send button turns into a green check for a moment and the marks clear.
A failed send keeps the marks, turns the button red and shows the error message beside the toolbar.

## Production

None of it reaches a production build: the overlay is a dynamic import behind
`import.meta.env.DEV` in `main.tsx`, the endpoint is a Vite plugin with `apply: "serve"`, and the
overlay is styled by its own plain CSS file imported with it (`src/dev/` is excluded from Tailwind's
sources, so no utility class of it reaches the app's CSS). The check is that `bun run build` output contains none of the overlay's identifiers (`zomfy-feedback`,
`react-grab`, `modern-screenshot`, `perfect-freehand`, its `zf-` classes).

# Libraries

Researched: agentation, react-grab, stagewise toolbar, code-inspector-plugin / react-dev-inspector,
click-to-component, html-to-image and modern-screenshot, perfect-freehand.

- **react-grab (`react-grab/primitives`)** for hit testing, the selector, the component name, the
  owner stack with source file:line and the computed styles. Vite's dev source maps name a source
  by its file name alone, so react-grab's frames say `ChatList.tsx`; the overlay takes the module's
  path from the same frame in React's `_debugStack` and the dev server writes it relative to the
  repository. React 19 dropped `_debugSource`;
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
