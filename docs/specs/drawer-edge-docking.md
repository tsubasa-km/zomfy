---
type: Spec
title: Docking the tool drawer
description: Drag the tool drawer's handle along an edge or dock it to any edge of the pane.
status: stable
x-zomfy-implementation: done
tags: [ui, tabs, drawer]
generated: { by: "codex/gpt-6", at: "2026-11-26T08:17:56Z" }
---

# Behavior

The tool drawer holds terminals, browsers, and workspace panels. Its handle starts centered under
the tab strip. The drawer uses the same saved edge and position in each pane, while each tab keeps
its own pin and selected tool.

- Drag the handle parallel to its edge to slide it along that edge. The handle stays within the pane
  when the pane is resized. The pin handle also accepts drags while the drawer is open.
- Pull away from the edge to detach the handle. A floating preview follows the pointer. Approaching
  any pane edge shows the snapped handle and highlights the target edge. Releasing there saves the
  new position. Releasing between edges, pressing Escape, or losing pointer capture leaves the
  previous position in place.
- The drawer opens inward from its edge. The resizing separator is at the opposite edge and
  changes height for top or bottom docking and width for left or right docking. Drag toward the
  center to expand. The drawer stays within its pane even when the pane shrinks.
- Each edge remembers its own size, and double-clicking its separator resets that edge alone. An
  existing saved drawer height becomes the top edge's height.

In Settings → Appearance → Interface, **Tool drawer** offers **Open on hover (default)** and
**Open on click**. The default opens after a short hover. In click mode, hovering the
closed handle leaves it closed. Clicking the handle or activating it with the keyboard opens it. Dragging the closed handle
moves it without opening it. The preference is saved with other app settings.

The open drawer overlays the pane and still closes when the pointer leaves it unless pinned.
Shortcuts and tool commands keep opening the drawer as before. Docking applies within the
drawer’s current pane.

# Acceptance

- With default settings, hovering the closed handle opens the drawer. Select **Open on click**,
  hover and drag the closed handle, and verify it stays closed. Click the handle and verify it opens.
  Reload to verify the preference is restored, then switch back to **Open on hover (default)**.
- Slide the top handle to either side, detach it, and dock it at the bottom, left, and right.
- In each position, open and pin the drawer, drag the pin handle, and resize from its inner edge.
- Cancel a drag and verify the drawer keeps its prior position and pin state.
- Switch tabs and restart to verify that placement and edge sizes are restored. Shrink a split pane
  and check that the handle and the resizing separator remain reachable.
