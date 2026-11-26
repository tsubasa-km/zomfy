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
selected tool and, in hover mode, its pin state. Docking gestures are available with **Open on click**. Both opening
modes use the saved edge and position.

- Drag the handle parallel to its edge to slide it along that edge. The handle stays within the pane
  when the pane is resized. The inner handle also accepts drags while the drawer is open.
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
**Open on click**. The hover mode opens after a short hover and uses the inner handle to pin
the drawer open when the pointer leaves. The handle and pin stay at their saved positions.

In click mode, the closed handle opens the drawer and the inner handle shows a close arrow.
Either handle can be clicked or activated with the keyboard. An open drawer stays open when
the pointer leaves. Dragging either handle moves the drawer without toggling it. Entering
click mode clears the active drawer’s pin.

The drawer overlays the pane and can be resized in both modes. Shortcuts and tool commands
open it in both modes and pin it in hover mode. Docking applies within the drawer’s current pane.
The preference is saved with other app settings.

# Acceptance

- With default settings, hovering the closed handle opens the drawer. Drag the closed handle or
  the pin and verify the edge and position stay fixed. Resize from the inner edge.
- Select **Open on click**, hover and drag the closed handle, and verify it stays closed.
  Click to open, move the pointer away, then click the close arrow. Verify click mode offers
  only the open and close controls. Reload to verify the preference is restored.
- In click mode, slide the top handle to either side, detach it, and dock it at the bottom, left,
  and right. In each position, open the drawer, drag the inner handle, and resize from its inner edge.
- Cancel a drag and verify the drawer keeps its prior position and visibility.
- Switch back to **Open on hover (default)** and verify the saved placement is fixed there and
  that pinning and unpinning work again.
- Switch tabs and restart to verify that placement and edge sizes are restored. Shrink a split pane
  and check that the handle and the resizing separator remain reachable.
