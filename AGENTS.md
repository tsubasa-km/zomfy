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

# Documentation first

`docs/` is an Open Knowledge Format (OKF v0.3) bundle; read the specs that touch your task before
changing code. A new feature or a change in behaviour starts with its spec in `docs/specs/`, agreed
before the code, and the work closes by marking it done — the flow is in
[docs/specs/documentation-driven-development.md](docs/specs/documentation-driven-development.md).
Write and validate the docs with the `okf-generate` skill (`.claude/skills/`); answer questions
from them with `okf-consume`. Small fixes that change no behaviour need no spec.

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
  `packages/daemon`, `apps/desktop` and `packages/relay-contract`, and `bun run test` in `apps/relay`
  when you touched the relay. Run them in the foreground: in a Zomfy chat a background command does
  not wake you once your turn has ended.

# Checking what you changed

A change that shows on screen is checked on screen before you call it done: run a preview of the
app, look at the result in screenshots, and say what you checked and what you could not. How to run
and drive a preview is in [apps/desktop/VERIFYING.md](apps/desktop/VERIFYING.md); read it when your
change touches the UI.

# Branches

The GitHub repository is `tsubasa-km/zomfy` (remote `github`); push and merge there with the
`tsubasa-km` account (`gh auth switch -u tsubasa-km`, and back to `zenk-t-suzuki` afterwards).

- `main` is what has been released. Nobody pushes to it: it changes only through a pull request
  from `development`, merged with a merge commit, which `bun run release` opens and merges.
- `development` is where finished work gathers. It takes only merges of topic branches, never
  commits of its own; it is never force-pushed or deleted.
- Every change starts on a topic branch from `development`: `feat/…`, `fix/…`, `chore/…` or
  `docs/…`, named for the change. Push it as you go, so no work lives only on one machine.
- A finished topic branch is merged into `development` with `git merge --no-ff`, so the merge
  commit keeps the branch's history together, after CI's checks pass on it. Push `development`,
  then delete the topic branch locally and on GitHub. A pull request into `development` merges
  the same way, and GitHub deletes its branch.
- Only merge commits are allowed on GitHub: squash and rebase merging are off.
