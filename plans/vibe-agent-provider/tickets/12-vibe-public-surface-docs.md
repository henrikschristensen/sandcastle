---
title: "Public surface and docs: exports, VibeOptions, guide pages, changeset, test list"
type: grilling
state: open
assignee: ""
blocked_by: [06-vibe-print-command, 07-vibe-stream-parsing, 11-vibe-init-scaffold]
---

## Question

What is the complete public-facing checklist for landing the vibe provider? Decide and enumerate in `## Resolution`:

- `src/index.ts` exports: the `vibe` factory and `VibeOptions` type (mirror how `codex`/`CodexOptions` are exported).
- `docs/guide/agent-providers.md`: new intro mention + a `VibeOptions` options table, following the existing per-provider sections; check `docs/guide/agent-sessions.md` for a resume section to extend; `tests/docs-guide.test.ts` rules (glossary-term links) apply.
- Changeset in `.changeset/` (minor — new feature, pre-1.0), package name from `package.json#name`.
- Test list in `src/AgentProvider.test.ts`: `buildPrintCommand` fresh + resume (+ fork error if `canFork: false`), `buildInteractiveArgs`, stream parsing incl. session-id extraction and error events, and sessionStorage round-trip capture host↔sandbox with cwd rewrite.
- Anything in `README.md` listing supported agents.
