---
title: "Decide: registry wiring — entry literal, placement, picker/flag, init special-casing"
type: grilling
state: closed
assignee: henrikschristensen
blocked_by:
  [
    04-host-repo-auth-wiring,
    05-list-view-close-commands,
    06-tea-tools-dockerfile-pin,
  ]
---

## Question

Lock the `ISSUE_TRACKER_REGISTRY` wiring in `src/InitService.ts`:

- The full entry object literal: `name: "gitea"`, label (e.g. "Gitea (Codeberg or self-hosted)"), `templateArgs` assembled from 05 and 06, `envExample` from 04, and `sandboxOptions`/`nativeSandboxOptions` — decide explicitly: none (Gitea is a remote API, no host state to mount, unlike beads).
- Position: between `beads` and `custom`; `github-issues` remains `[0]` and the default. Confirm `--issue-tracker gitea` and the interactive picker pick the entry up with no extra code (check `cli.ts` and `interactive.ts` for hardcoded tracker names — e.g. the `github-issues` special cases in `envNotes` and line ~982).
- Any init special-casing the entry needs: the native-sandbox env note (04), next-steps text, and whether `docs/guide/cli.md`'s `--issue-tracker` row enumerates names literally.

## Resolution

Locked via grilling (2026-11-07), building on 04/05/06:

- **Entry literal**, placed between `beads` and `custom` (`github-issues` stays `[0]` and the default):
  - `name: "gitea"`, `label: "Gitea (Codeberg or self-hosted)"`
  - `templateArgs`: LIST/VIEW/CLOSE from 05 + `ISSUE_TRACKER_TOOLS: TEA_TOOLS` from 06
  - `envExample` from 04; **no `sandboxOptions`/`nativeSandboxOptions`** — Gitea is a remote API, no host state to mount (unlike beads)
- **Flag/picker need no extra code**: `--issue-tracker` validates against `listIssueTrackers()` names and the interactive picker is built from the same list (cli.ts), so `gitea` works automatically once registered.
- **`--create-label` stays github-only** (host `gh label create` at init; gitea has no guaranteed host tea, and the token isn't set at init time). For gitea the `Sandcastle` label is created by the user — web UI or `tea labels create` — documented in next-steps and docs (08). `rewritePromptFiles`' ` --label Sandcastle` strip is gh-specific and untouched; gitea's `--labels Sandcastle` filter is always on.
- **envNotes**: extend the native-provider (`image === undefined`) special case from github-issues to gitea, with the line approved in 04: "<provider>() hides your host's tea login from the agent, so put GITEA_TOKEN in .sandcastle/.env for tea to use."
- **Next steps** for a gitea project add two instructions: (1) create the `Sandcastle` label on the Gitea repo — tea silently drops unknown labels, so without it list returns ALL open issues; (2) the repo's git remote must point at `GITEA_INSTANCE_URL` (default `https://codeberg.org`) or tea can't resolve the repo (04).
