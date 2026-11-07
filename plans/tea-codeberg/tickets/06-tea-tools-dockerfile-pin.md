---
title: "Decide: TEA_TOOLS Dockerfile snippet and tea version pinning policy"
type: grilling
state: closed
assignee: henrikschristensen
blocked_by: [02-tea-docker-install]
---

## Question

Lock the `TEA_TOOLS` Dockerfile-snippet constant in `src/InitService.ts`:

- Pinned version: a `TEA_VERSION` const plus `ARG TEA_VERSION=…` in the RUN block, mirroring `BEADS_VERSION` — which version (from 02), and does the scaffold let the user override via ARG like beads does?
- The single-RUN-block install with checksum verification to `/usr/local/bin/tea` (from 02), placed where `{{ISSUE_TRACKER_TOOLS}}` sits (before `USER agent`), with apt-list cleanup and no user switch.
- Any runtime deps the image needs for tea (from 02 — expect none if static).
- Host-vs-image drift warning: decide explicitly whether a `teaVersionWarning` analog to `beadsVersionWarning` is needed. Expected answer: no — tea keeps no shared local state (its login config is per-sandbox), unlike bd's database. State the reasoning in the ticket resolution.

## Resolution

Locked via grilling (2026-11-07), grounded in `research/tea-docker-install.md` (ticket 02):

- **Pin `0.16.0` with an ARG override**, mirroring `BEADS_VERSION`: a `TEA_VERSION = "0.16.0"` const in `src/InitService.ts` plus `ARG TEA_VERSION=${TEA_VERSION}` in the snippet, so a build can override without editing the scaffold.
- **TEA_TOOLS = the §5 candidate block verbatim**: one `RUN` that installs `ca-certificates curl xz-utils`, downloads `tea-${TEA_VERSION}-linux-${ARCH}.xz` from `https://gitea.com/gitea/tea/releases/download/v${TEA_VERSION}` (`ARCH=$(dpkg --print-architecture)` maps 1:1 to the asset suffix), verifies with `curl …/checksums.txt | grep " ${TEA_ASSET}$" | sha256sum -c -` (the beads pattern works verbatim), decompresses, `install -m 0755` to `/usr/local/bin/tea`, removes the downloads, cleans apt lists, and sanity-checks with `tea --version` (tea has **no `version` subcommand** — unlike `bd version`).
- **Runtime deps: none.** The binary is fully static (`CGO_ENABLED=0`; `ldd` → "not a dynamic executable"), so bookworm's glibc is irrelevant and no packages are needed beyond the download tools. No apt package route: bookworm's `tea` is the unrelated TEA text editor, and Gitea's package hosts carry only the `gitea` server.
- **No `teaVersionWarning`.** Reasoning recorded: `beadsVersionWarning` exists because bd owns the shared `.beads/` database and host/image version skew corrupts it. tea keeps no shared local state — auth is env-only per ticket 04 and any tea config would be per-sandbox — so the host's tea version never affects sandbox behavior. No drift warning is warranted.
