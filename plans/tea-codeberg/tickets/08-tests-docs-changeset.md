---
title: "Decide: tests, docs/guide updates, and changeset for the gitea entry"
type: grilling
state: open
assignee: henrikschristensen
blocked_by: [07-registry-wiring]
---

## Question

Lock the verification and publication surface for the `gitea` entry:

- Tests in `src/InitService.test.ts` mirroring the github-issues/beads coverage: `listIssueTrackers()` includes `gitea` in the right position, `getIssueTracker("gitea")` returns the expected `templateArgs`/`envExample`, the default entry is still `github-issues`, generated prompts contain the substituted commands, `.env.example` includes the token/server lines, and the `--issue-tracker gitea` CLI path works (check `interactiveArgCollection.test.ts` / `cli.ts` tests for hardcoded tracker lists).
- `docs/guide/` updates: `init.md` (the "GitHub Issues, Beads, or Custom" sentence), `cli.md` (`--issue-tracker` row), and the `glossary.md` `issue tracker` entry if it enumerates examples. Respect `tests/docs-guide.test.ts` (glossary-term linking rules; a new mention of a glossary term must be linked on its first mention per page rules).
- Changeset: `.changeset/` entry, `minor` for `@ai-hero/sandcastle` (new feature, pre-1.0), checking existing changesets for duplicates.
- `README.md` Documentation list only if a guide page changed slug (expected: no new page).
