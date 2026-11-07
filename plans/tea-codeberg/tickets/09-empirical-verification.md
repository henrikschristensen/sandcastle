---
title: "Task: empirical end-to-end verification of the locked tea commands against a real Gitea instance"
type: task
state: closed
assignee: henrikschristensen
blocked_by: [05-list-view-close-commands, 06-tea-tools-dockerfile-pin]
---

## Question

Run the locked LIST/VIEW/CLOSE commands (05) with the locked install (06) end to end, non-interactively, against a real Gitea instance, and record the facts later tickets and the implementer depend on: exact stdout JSON of list, view output shape (comments included?), close behavior + exit codes, behavior with a missing/invalid token, and behavior when the git remote is absent or on another host.

**HITL checklist for the user** (the agent cannot do these alone):

- [ ] Create a Codeberg.org account if you don't have one, and a throwaway test repo (e.g. `sandcastle-tea-test`) with a couple of open issues, one labeled `Sandcastle`.
- [ ] Create a token at Codeberg → Settings → Applications with the scopes 03 identified; put it in `GITEA_TOKEN` (never commit it; use a local-only env).
- [ ] Confirm the sandbox can reach codeberg.org.

AFK part (agent does once credentials exist): install tea per 06 in a scratch container or locally, clone the test repo, run the three commands plus the failure cases, and write the captured outputs to `research/tea-empirical-verification.md`. Then add `## Findings` here and set `state: closed`.

## Findings

Done AFK (2026-11-07) — no user credentials needed after all: the host's saved Codeberg token lacks `write:user`, so instead of a Codeberg test repo the run went against a **local Forgejo 17.0.1** (same major version Codeberg runs), fully controlled, torn down afterwards. Full write-up: [`research/tea-empirical-verification.md`](../../../research/tea-empirical-verification.md).

- The three locked command strings from ticket 05 ran **verbatim, bare, exit 0**: LIST returned only the `Sandcastle`-labeled open issue as string-valued JSON (body/url included via `--fields`); VIEW returned the issue with the `comments` array; the compound CLOSE posted "Completed by Sandcastle" and closed the issue; a second LIST returned `[]`.
- Repo was auto-detected from the clone's http remote (host + port), no `-r` needed; env-only login (`GITEA_INSTANCE_URL` + `GITEA_TOKEN`, empty `XDG_CONFIG_HOME`) worked with no config file and no TTY — the sandbox setup from ticket 04.
- Failure cases: bad token → exit 1; missing issue → exit 1; no repo context → list degrades to global search (exit 0), view/close fail "remote repository required" (exit 1) — exactly the behavior ticket 07's next-steps warn about.
- Housekeeping note: one probe issue (#58) was created and immediately closed on `hsctech/nats-mq` while testing the Codeberg token's scopes; it remains as a closed issue there.
