---
title: "Decide: tests, docs/guide updates, and changeset for the gitea entry"
type: grilling
state: closed
assignee: henrikschristensen
blocked_by: [07-registry-wiring]
---

## Question

Lock the verification and publication surface for the `gitea` entry:

- Tests in `src/InitService.test.ts` mirroring the github-issues/beads coverage: `listIssueTrackers()` includes `gitea` in the right position, `getIssueTracker("gitea")` returns the expected `templateArgs`/`envExample`, the default entry is still `github-issues`, generated prompts contain the substituted commands, `.env.example` includes the token/server lines, and the `--issue-tracker gitea` CLI path works (check `interactiveArgCollection.test.ts` / `cli.ts` tests for hardcoded tracker lists).
- `docs/guide/` updates: `init.md` (the "GitHub Issues, Beads, or Custom" sentence), `cli.md` (`--issue-tracker` row), and the `glossary.md` `issue tracker` entry if it enumerates examples. Respect `tests/docs-guide.test.ts` (glossary-term linking rules; a new mention of a glossary term must be linked on its first mention per page rules).
- Changeset: `.changeset/` entry, `minor` for `@ai-hero/sandcastle` (new feature, pre-1.0), checking existing changesets for duplicates.
- `README.md` Documentation list only if a guide page changed slug (expected: no new page).

## Resolution

Locked via grilling (2026-11-07):

- **Tests** (`src/InitService.test.ts` + CLI arg tests, mirroring github-issues/beads/custom coverage):
  - `listIssueTrackers()` includes `gitea`, positioned before `custom`, with `github-issues` still first/default
  - `getIssueTracker("gitea")` returns the #20 command strings in `templateArgs`, `TEA_TOOLS` in `ISSUE_TRACKER_TOOLS`, and the #19 `envExample`
  - `.env.example` generation for gitea includes `GITEA_INSTANCE_URL`/`GITEA_TOKEN`
  - scaffolded prompts get the three tea commands substituted; the Dockerfile gets `TEA_TOOLS` at `{{ISSUE_TRACKER_TOOLS}}`
  - `--issue-tracker gitea` accepted by the CLI flag path (check `interactiveArgCollection.test.ts`/cli tests for hardcoded tracker lists)
  - `envNotes` gitea native-provider line (from #22) is covered
- **Docs** (`docs/guide/`, respecting `tests/docs-guide.test.ts` — linked glossary mentions, no ADR refs):
  - `init.md`: picker sentence gains Gitea — "(GitHub Issues, Gitea, Beads, or Custom)" — plus a short Gitea paragraph: create the `Sandcastle` label on the repo, the git remote must point at `GITEA_INSTANCE_URL` (default `https://codeberg.org`), and the `GITEA_INSTANCE_URL`/`GITEA_TOKEN` env vars
  - `cli.md`: `--issue-tracker` row gains `` `gitea` ``; `--create-label` row unchanged (stays github-only per #22)
  - `glossary.md`: `issue tracker` entry examples gain Gitea
- **Changeset**: new `.changeset/gitea-issue-tracker.md`, `"@ai-hero/sandcastle": minor`, body summarizing the new `gitea` issue tracker (tea CLI; Codeberg or any Gitea/Forgejo). No duplicate exists in `.changeset/`.
- **Confirmed out of this ticket:** `SETUP_ISSUE_TRACKER.md` (custom flow — out of scope while charting), `docs/agents/*`, README Documentation list (no page slug changes).
