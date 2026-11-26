---
type: Spec
title: Save is offered only when something changed, and says when it is saving
description: Settings with an explicit Save step compare the form with what is saved; Save is disabled (in dialogs) or hidden (in a settings row) until something differs, reads "Saving…" while it runs, and closes the dialog or says "Saved" when done.
status: stable
x-zomfy-implementation: done
tags: [desktop, settings, forms]
generated: { by: "claude-code/opus-5.5", at: "2026-11-26T00:00:00Z" }
---

# Problem

Project Settings' Save was always enabled and gave no sign that anything happened: pressing it with
nothing changed, or while the save ran, looked the same as a save that worked. Other screens with a
Save step had the same gap, each with its own ad-hoc `saving` flag or none.

# What it does

One helper, `apps/desktop/src/lib/use-save-state.ts`:

- `sameFormValue(saved, current)` compares plain form data (objects by content, key order ignored,
  an `undefined` field the same as a missing one; arrays in order).
- `useSaveState(saved, current, action)` gives `dirty`, `saving`, `justSaved` (two seconds after a
  save that worked) and `save`, which runs the action once at a time. The action returns false or
  throws when the save failed; the form shows why itself.

Where it is used:

| Screen | Save |
| --- | --- |
| Project Settings | disabled until a field differs from the project's saved settings ("Nothing has changed"), "Saving…" while it runs, closes on success, stays open with the error on failure |
| Workspace details | the same |
| Edit bot | disabled until something differs; "Saving…" |
| Edit workflow agent | disabled until something differs; "Saving…" |
| Edit SSH login | disabled until something differs; "Saving…" |
| Edit automation (schedule, trigger) | disabled until something differs |
| Settings → Agents → environment value | shown only while a value is typed; "Saving…", then "Saved" for a moment; a failed save keeps what was typed |

Creating something new (a bot, an agent, an automation, a login) is not gated on changes. Settings
that apply as they change (switches, selects, fields saved on blur) are unchanged.

# Out of scope

- The workflow editor, which already tracks unsaved changes and disables Save without them.
- Relay pairing (Pair is not a save step).

# Acceptance

- `tests/save-state.test.ts`: equal forms are not dirty whatever their key order; any differing
  field, nested value or array item is; `undefined` equals missing but not `null` or empty.
- In a preview, Project Settings opens with Save disabled, enables it when a field changes, and
  disables it again when the field is changed back.
