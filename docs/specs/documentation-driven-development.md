---
type: Spec
title: Documentation-driven development
description: How a change to Zomfy goes from spec to code, and how the docs stay true afterwards.
status: stable
x-zomfy-implementation: done
tags: [docs, process]
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Why

Agents and people change Zomfy in parallel. A short spec agreed first keeps them building the same
thing, and lets a reviewer check the code against what was meant rather than against itself.

# The flow

1. **Spec first.** Before writing code for a feature (or a change to one), write or update its
   `Spec` in `docs/specs/`: the problem, who it is for, what it does, what it does not, the
   acceptance checks, and open questions. Keep it short. Set `status: draft` and
   `x-zomfy-implementation: planned`.
2. **Agree.** The person reads it; open questions are answered in the spec. Then `status: stable`.
   Small fixes that change no behaviour need no spec.
3. **Build to the spec.** Set `x-zomfy-implementation: in-progress`; commits that implement it
   reference the spec path. A choice that shapes
   more than this feature gets a `Decision` in `docs/decisions/`.
4. **Close.** When the acceptance checks pass, set `x-zomfy-implementation: done` in the same branch, and add
   a line to `docs/log.md`. If the code ended up different from the spec, change the spec to match
   what was built and say why.

# Format

- OKF v0.3 ([decision](../decisions/adopt-okf.md)): YAML front matter with `type` (`Spec`,
  `Decision`, `Research`, `Guide`), `title`, a one-sentence `description`, `status` (`draft`,
  `stable`, `deprecated`), `tags`, and `x-zomfy-implementation` on specs; other keys that only Zomfy
  uses are named `x-zomfy-<name>`.
- Each directory's `index.md` lists its documents with their descriptions; update it when adding one.
- Validate with the `okf-generate` skill (`.claude/skills/okf-generate/scripts/validate.py docs`).

# Acceptance

- `docs/` validates as an OKF bundle.
- Every feature merged after this spec has a `Spec` whose `x-zomfy-implementation` matches the code.
