---
name: zomfy-worktrees
description: How to work in git worktrees in a project Zomfy manages, through Zomfy's harness tools (create_workspace, create_session, split_work, send_prompt, wait_for_session, claim_worktree, finish_worktree). Use it before creating, switching to, merging or deleting a worktree or branch for parallel work, when asked to hand work to another agent, or when a request has parts that could run side by side. Do not use raw `git worktree add` or another tool's worktree commands in a Zomfy project.
---

# Worktrees in a Zomfy project

Zomfy gives each chat that needs its own branch a git worktree of its own and keeps track of them:
it lists them in its sidebar, runs the project's setup script in new ones, shows their size, and
cleans up the ones whose work is merged. It can only do that for worktrees it made. So in a project
Zomfy manages:

- **Do not run `git worktree add`, `git worktree remove`, or another tool's worktree commands.** Use
  the tools below, from the `harness` MCP server. Each tool describes its own arguments.
- **Do not delete a worktree, its folder, or its branch yourself**, even when its work is merged.
  `finish_worktree` and Zomfy's cleanup do that, after checking nothing would be lost.

## Which tool

| You want to | Use |
| --- | --- |
| See the projects, worktrees and chats | `list_workspaces`, `list_sessions` |
| Start another agent on work that needs its own branch | `create_workspace` (a new worktree with an agent in it) |
| Start another agent in an existing worktree | `create_session` |
| Run two or more independent parts of your task at once | `split_work` (one worktree and helper per part, merged back into yours) |
| Talk to another chat, and wait for it | `send_prompt`, then `wait_for_session`; `read_session` to see what it did |
| Change another worktree yourself, briefly | `claim_worktree` (every chat there must be idle) |
| Bring your finished, committed work home | `finish_worktree` (merges or opens a pull request, as the project is set up) |

Prefer an existing worktree and chat over a new one. Give a new agent a prompt that stands on its
own: the goal, the files, what is already decided, and how to check the result.

## Before finishing

Commit your work on your own branch first; `finish_worktree` refuses uncommitted changes and never
discards anything. If the main checkout has changes of its own or the merge conflicts, it says so:
tell the person rather than forcing it.

## Disk space

Worktrees share the package manager's cache through hardlinks, so a new worktree costs little.

- Do not run `bun install` (or another install) in a worktree the setup script has already prepared,
  unless the dependencies changed.
- Leave build output (`target/`, `dist/`) where it is; Zomfy's cleanup removes it from idle
  worktrees. If a turn starts with a note that Zomfy removed this worktree's `node_modules` and
  build output, run the setup script or the install command before building.
