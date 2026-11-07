---
title: "Decide: TEA_TOOLS Dockerfile snippet and tea version pinning policy"
type: grilling
state: open
assignee: henrikschristensen
blocked_by: [02-tea-docker-install]
---

## Question

Lock the `TEA_TOOLS` Dockerfile-snippet constant in `src/InitService.ts`:

- Pinned version: a `TEA_VERSION` const plus `ARG TEA_VERSION=…` in the RUN block, mirroring `BEADS_VERSION` — which version (from 02), and does the scaffold let the user override via ARG like beads does?
- The single-RUN-block install with checksum verification to `/usr/local/bin/tea` (from 02), placed where `{{ISSUE_TRACKER_TOOLS}}` sits (before `USER agent`), with apt-list cleanup and no user switch.
- Any runtime deps the image needs for tea (from 02 — expect none if static).
- Host-vs-image drift warning: decide explicitly whether a `teaVersionWarning` analog to `beadsVersionWarning` is needed. Expected answer: no — tea keeps no shared local state (its login config is per-sandbox), unlike bd's database. State the reasoning in the ticket resolution.
