---
type: Decision
title: Adopt OKF for the docs
description: The docs are an Open Knowledge Format v0.3 bundle that people and agents read before working on Zomfy.
status: stable
tags: [docs, process]
sources:
  - resource: https://github.com/open-knowledge-format/open-knowledge-format/blob/main/SPEC.md
generated: { by: "claude-code/opus-5.5", at: "2026-11-22T00:00:00Z" }
---

# Context

Zomfy is built mostly by agents working in parallel worktrees. Each starts with only what is in the
repo, so the reasons behind a feature have to live in the repo, in a form an agent finds and trusts.
The person asked for documentation-driven development using Google's Open Knowledge Format (OKF).

# Decision

- `docs/` is an OKF v0.3 bundle: a root `index.md` with `okf_version: "0.3"`, an `index.md` per
  directory listing its documents with their `description`, and a `log.md` of changes.
- Every document has YAML front matter with a `type`; Zomfy's types are `Spec`, `Decision`,
  `Research` and `Guide`. `status` is OKF's: `draft` while it is being agreed, `stable` once agreed,
  `deprecated` with `superseded_by`. How far the code has got is `x-zomfy-implementation`:
  `planned`, `in-progress` or `done`.
- Files without a `type` (`README.md`, `AGENTS.md`) are not part of the bundle, as OKF allows.
- The OKF agent skills `okf-generate` and `okf-consume` are vendored in `.claude/skills/` so agents
  can write, validate and read the bundle.

# Consequences

- A feature starts with its spec; reviewing a change includes reading the spec it claims to meet.
- Links between documents are relative Markdown links, so they work on GitHub and in the bundle graph.
