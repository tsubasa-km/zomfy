# Language

The person working on this repo reads Japanese. Use Japanese for everything said to them, and English for everything that lands in the repo or the app.

**Japanese**
- Chat replies, progress notes, summaries and recaps
- Questions and choices put to the person, including button labels and option text
- Explanations of what changed, why, and what is left

**English**
- Code, identifiers, code comments and test names
- Commit messages, release notes and pull request text
- UI strings in the app, log lines and error messages
- Docs and other files committed to the repo, including this one

When a reply mentions an English UI label, command or file name, keep it as written (`Check now`, `bun run release`) inside the Japanese sentence.

Keep to Japanese even when the last message was an English button label, a tool result, or an agent's report.

# Working in parallel

This repo is often worked on by several agents at once, each in a git worktree of its own. Keep the
merges cheap:

- Change only the files your task is about. When a change to a shared contract (`packages/protocol`,
  a store's shape, a component's props) is needed, make it on its own and commit it before the work
  that builds on it.
- Files every feature touches conflict most: `packages/protocol/src/*` and the translation files in
  `apps/desktop/src/i18n/ja/`. Add to them; never reorder or reformat what is already there.
- Add dependencies only when the task asks for them, in a commit of their own, so `bun.lock` changes
  in one place only.
- Commit on your own branch; do not merge, rebase or switch branches unless asked.
- Before you say the work is done, run what CI runs: `bun run typecheck`, then `bun test` in
  `packages/daemon` and in `apps/desktop`.
