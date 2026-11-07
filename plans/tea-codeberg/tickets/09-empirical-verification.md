---
title: "Task: empirical end-to-end verification of the locked tea commands against a real Gitea instance"
type: task
state: open
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
