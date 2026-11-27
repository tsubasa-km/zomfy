---
type: Spec
title: Docking the tool drawer
description: Drag the tool drawer's handle along an edge or dock it to any edge of the pane.
status: stable
x-zomfy-implementation: done
tags: [ui, tabs, drawer]
generated: { by: "codex/gpt-6", at: "2026-11-26T10:36:24Z" }
---

# Behavior

The tool drawer holds terminals, browsers, and workspace panels. Its handle starts centered under
the tab strip. The drawer uses the same saved edge and position in each pane. Each tab keeps its
selected tool and its hover-mode pin. Moving and docking work the same in both opening modes; the
modes differ only in how the drawer opens.

- Drag the handle parallel to its edge to slide it along that edge. A slide that runs past the
  pane's end or out past its edge keeps the handle on that edge, clamped to the pane. The handle
  stays within the pane when the pane is resized. The inner handle (the pin in hover mode, the
  close arrow in click mode) also accepts drags while the drawer is open.
- Pull the handle into the pane to detach it. A floating preview follows the pointer. Approaching
  any pane edge shows the snapped handle and highlights the target edge. Releasing there saves the
  new position. Releasing between edges, pressing Escape, or losing pointer capture leaves the
  previous position in place.
- A drag moves the drawer without opening, closing, or pinning it. The handles show a grab cursor;
  their tooltips name what they hold or do, not how to drag them.
- The drawer opens inward from its edge. The resizing separator is at the opposite edge and
  changes height for top or bottom docking and width for left or right docking; its tooltip says
  which. Drag toward the center to expand. The drawer stays within its pane even when the pane
  shrinks. The least depth is 192 px for top or bottom and 280 px for left or right, defined once
  in `drawer-docking.ts`.
- Each edge remembers its own size, and double-clicking its separator resets that edge alone. An
  existing saved drawer height becomes the top edge's height.
- Under the handle's edge a tab's content keeps clear of it in its own way, as it does at the top:
  a thread's transcript starts clear of a top handle and scrolls under it and is inset from a side
  handle, the composer's own bottom padding clears a bottom handle, terminals along that edge pad
  their screen, and panels pad themselves. No strip is reserved along the whole pane.

In Settings → Appearance → Interface, **Tool drawer** offers **Open on hover (default)** and
**Open on click**. A saved value outside these falls back to the default.

In hover mode the drawer opens after a short hover over its handle. Pressing the pointer on the
handle during that delay cancels the opening and starts a drag; a click without a drag opens the
drawer at once. The inner handle pins the drawer open when the pointer leaves.

In click mode, the closed handle opens the drawer and the inner handle shows a close arrow. An open
drawer stays open when the pointer leaves. Entering click mode clears the pin of the active (focused
pane's) drawer only; other tabs keep their pins for when hover mode returns.

Either handle can be activated with the keyboard. Opening from the keyboard moves focus to the
drawer's first control; closing while focus is inside the drawer returns it to the handle.

The drawer overlays the pane and can be resized in both modes. Shortcuts and tool commands
open it in both modes and pin it in hover mode. Docking applies within the drawer’s current pane.
The preference is saved with other app settings.

# Acceptance

- With default settings, hovering the closed handle opens the drawer. Press on the handle before it
  opens and drag it along the top, then to the bottom, left, and right edges; verify it stays closed
  while dragging and lands where released. Open it, drag the pin, and verify pinning still toggles
  on a plain click.
- Select **Open on click**, drag the closed handle, and verify it stays closed. Click to open, move
  the pointer away, then click the close arrow. Reload to verify the preference is restored.
- In both modes, slide the top handle to either side, detach it, and dock it at the bottom, left,
  and right. In each position, open the drawer, drag the inner handle, and resize from its inner
  edge; the separator's tooltip names height or width.
- Slide a handle fast past the pane's end and release outside the pane: it stays on its edge at the
  end. Cancel a drag and verify the drawer keeps its prior position and visibility.
- Dock at the bottom, left, and right: no blank strip runs along the whole pane, and the handle
  does not cover the composer or a terminal's text.
- Pin a drawer in one tab, switch to click mode from another, then back to hover mode: the first
  tab's drawer is still pinned.
- Focus the closed handle with Tab and press Enter: focus moves into the drawer. In click mode,
  activate the close arrow with the keyboard: focus returns to the handle.
- In Japanese, the handles, the separator, and the tour's drawer stops are translated.
- Switch tabs and restart to verify that placement and edge sizes are restored. Shrink a split pane
  and check that the handle and the resizing separator remain reachable.
