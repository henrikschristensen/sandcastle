---
title: "Public surface and docs: exports, VibeOptions, guide pages, changeset, test list"
type: grilling
state: closed
assignee: henrikschristensen
blocked_by: [06-vibe-print-command, 07-vibe-stream-parsing, 11-vibe-init-scaffold]
---

## Question

What is the complete public-facing checklist for landing the vibe provider? Decide and enumerate in `## Resolution`:

- `src/index.ts` exports: the `vibe` factory and `VibeOptions` type (mirror how `codex`/`CodexOptions` are exported).
- `docs/guide/agent-providers.md`: new intro mention + a `VibeOptions` options table, following the existing per-provider sections; check `docs/guide/agent-sessions.md` for a resume section to extend; `tests/docs-guide.test.ts` rules (glossary-term links) apply.
- Changeset in `.changeset/` (minor — new feature, pre-1.0), package name from `package.json#name`.
- Test list in `src/AgentProvider.test.ts`: `buildPrintCommand` fresh + resume (+ fork error if `canFork: false`), `buildInteractiveArgs`, stream parsing incl. session-id extraction and error events, and sessionStorage round-trip capture host↔sandbox with cwd rewrite.
- Anything in `README.md` listing supported agents.

## Resolution

Locked via grilling with the user (2026-11-07). The landing checklist for the vibe provider:

1. **Exports:** add `vibe` to the factory value-exports and `VibeOptions` to the type exports of the AgentProvider module in `src/index.ts` (mirrors codex). `transferVibeMetaJson` stays internal (pi/copilot precedent).
2. **Docs:** `docs/guide/agent-providers.md` — add Vibe to the intro provider list and a `## VibeOptions` options-table section (`env`, `captureSessions`, `sessionStorage.hostSessionsDir`/`sandboxSessionsDir`). `docs/guide/agent-sessions.md` — add vibe's host storage path `~/.vibe/logs/session/unified/<session-id>/` (a directory; cwd fields in `meta.json` rewritten on transfer), add `vibe()` to the captureSessions-default and resume lists, and add the resume/fork table row: resumes via `vibe --resume <id>`, fork throws `ForkNotSupportedError`. README untouched (it links the pages, no per-agent list). `tests/docs-guide.test.ts` glossary-linking rules apply.
3. **Changeset:** `.changeset/` entry with `"@ai-hero/sandcastle": minor` (new feature, pre-1.0 per repo rule) summarizing the vibe provider.
4. **Tests** (`src/AgentProvider.test.ts`, per-factory describe blocks as prior art): buildPrintCommand fresh / no-skip-permissions / resume + stdin prompt + fork throw; buildInteractiveArgs; stream parsing from the committed sanitized fixtures (`research/vibe-p-output-schema.md` §5, `research/vibe-roundtrip/run1.out`); parseSessionUsage/parseSessionContextWindow (last journal usage line, codex-style buckets); transferVibeMetaJson pure-fn tests; sessionStorage round-trip with a fake handle (capture/resume, cwd rewrite, existsOnHost, hostSessionFilePath, readHostSession journal order, findByIdOnHost fallbacks); captureSessions flag case.
