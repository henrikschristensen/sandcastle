---
title: "Decide: registry wiring — entry literal, placement, picker/flag, init special-casing"
type: grilling
state: open
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
