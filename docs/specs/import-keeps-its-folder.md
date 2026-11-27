---
type: Spec
title: An imported conversation keeps its own folder
description: Importing a conversation an agent's CLI recorded puts the thread in the workspace that owns the recorded folder and runs it in that folder, a subfolder included; only an explicit "Import into" places it elsewhere.
status: stable
x-zomfy-implementation: in-progress
tags: [threads, import, daemon, desktop]
generated: { by: "claude-code/opus-5.5", at: "2026-11-27T00:00:00Z" }
---

# Problem

Importing a conversation silently changed the folder it runs in:

- `_harness/sessions/history` asked for one workspace attributed every listed conversation to that
  workspace, even ones Claude found from there but recorded in another folder (another worktree of
  the repository, or a folder whose name Claude files under the same key: `a\b-c` and `a\b\c` both
  become `a-b-c`).
- The desktop imported with that workspace, and the daemon created the thread with the workspace's
  root as its folder. A conversation from a subfolder or a sibling worktree then ran somewhere else;
  Claude could not resume it there and started a new conversation with a handoff.
- A conversation recorded in a subfolder of a workspace, imported without a workspace, had its
  subfolder added as a new project.

# Behaviour

## Which workspace owns a conversation

The **owner** of a listed conversation is, among the host's workspaces (the floating one aside):

1. the workspace whose folder is the recorded folder;
2. else the workspace whose folder contains it, the deepest when several do (a worktree nested in
   its project's folder owns its own files);
3. else none.

A recorded folder that no longer exists has no owner and is listed with `folderMissing: true`.
Folders compare as one when they name the same place however they were written down: on Windows
case-insensitively, with or without a `\\?\` prefix, either slash, with or without a trailing
separator. `workspaceForFolder` compares the same way.

## Listing

- Every folder (no workspace asked): each conversation with its owner.
- One workspace: what each agent finds for that folder, plus the conversations recorded below it
  (from every folder's list). Each still carries its own owner, so a conversation found from here
  but recorded in another workspace's folder says so; the dialog marks it.

## Importing

`_harness/sessions/resume`:

- **No workspace named** (Import n, Recent conversations): the thread goes to the owner and runs in
  the recorded folder, a subfolder of the workspace included, so the agent continues its own
  conversation. A folder no workspace has is added as a project, as before. A folder that is gone
  fails with "This conversation's folder is gone (…): choose the workspace to import it into".
- **A workspace named** (only "Import into {name}"): when the recorded folder is that workspace's
  folder or lies below it and still exists, the thread runs in the recorded folder; otherwise it
  runs in the workspace's folder and the agent is handed a selection of the thread, as before.

## Chats whose folder is a subfolder of their workspace

A thread's folder (`cwd`) may lie below its workspace's root. Everything that runs the agent already
uses the thread's folder: the agent process, Continue in terminal, sign-in terminals, tool paths
shortened in the transcript. Besides that:

- Relative paths the agent writes in the chat (links, path code, images) resolve against the
  thread's folder, not the workspace root.
- Files picked from the composer's `@` menu are inserted relative to the thread's folder (`@x.ts`,
  `@../y.ts`), as the agent reads them.
- The explorer, the workspace's terminals and Search stay on the workspace root.
- When the project is pointed at another folder, a chat in a subfolder follows to the same subfolder
  of the new folder.
- Moving the chat to another workspace (`move_chat`) runs it in that workspace's folder, as before.

## The dialog's rows

In "this workspace" scope a row shows where it would run when that is not the workspace's own folder:

| Row | Shows |
| --- | --- |
| Recorded in a subfolder | folder icon and the path below the workspace |
| Recorded in another workspace's folder | a "different folder" icon in the warning colour and that workspace's name; its Import goes there; an **Import into {here}** button places it here instead |
| Folder gone | a crossed-out folder icon in the muted destructive colour and the folder's name |

No sentence explains these; the full path is the icon's tooltip. "Import into {name}" also stays on
a row whose import failed.

## Fork and rewind before the first message

A Claude thread imported where Claude cannot reopen the conversation has no Claude conversation of
its own until its first message, which hands Claude the thread. Until then:

- **Fork** copies the thread (through the chosen exchange) and the fork hands Claude that copy with
  its first message. It used to come out empty.
- **Rewind** keeps what is left to hand over. It used to drop the handoff, so Claude would have
  started knowing nothing of the thread.

## Recent conversations (an empty thread)

Lists the conversations this workspace owns (its folder and below) that no thread shows yet, and
imports one without naming a workspace.

# Acceptance

- `bun test` in `packages/daemon`: fixture conversations recorded in the exact folder, a subfolder,
  a sibling worktree, a missing folder and Windows path variants (case, `\\?\`, `/`) are attributed
  to the right workspace, list in the right scope, and import into their own folder (Claude resumes
  natively from a subfolder); an explicit workspace keeps the handoff path; relocation keeps a
  subfolder.
- `bun test` in `apps/desktop`: relative links and `@` mentions against a subfolder chat; which rows
  are marked; Recent conversations' filter.
- Preview screenshot of the Import dialog with a different-folder row, a subfolder row and a gone
  row, from fixture data in the preview's own home.
