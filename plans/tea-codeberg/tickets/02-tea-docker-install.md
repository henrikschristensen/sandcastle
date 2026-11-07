---
title: "Research: installing a pinned tea release in a Debian sandbox image (assets, checksums, Dockerfile RUN block)"
type: research
state: open
assignee: henrikschristensen
blocked_by: []
---

## Question

How do we install a **pinned** `tea` release into the Debian bookworm-based sandbox image with a single Dockerfile `RUN` block, mirroring `BEADS_TOOLS` in `src/InitService.ts`? Need:

- Release asset naming: what are the exact file names for linux amd64/arm64 (e.g. `tea_0.9.0_linux_amd64.tar.gz` vs `.zip` vs bare binary), and at which URL (code.gitea.io/tea/releases, gitea.com/gitea/tea/releases, dl.gitea.com?).
- Checksums: is there a `checksums.txt` / `sha256sums.txt` release asset, and its exact format (so the Dockerfile can `grep … | sha256sum -c -` like the beads install)?
- Static or dynamically linked binary? glibc requirement vs Debian bookworm's glibc 2.36 — any runtime deps to apt-install?
- Is there an apt package (packages.gitea.io? Debian proper?) — and if so, why the binary release is still preferred (pinning, checksums, reproducibility)?
- The latest stable tea version number as of today, and whether release tags are `vX.Y.Z`.

## Sources (primary only)

- https://code.gitea.io/tea/releases and https://gitea.com/gitea/tea/releases (asset lists for the last few releases).
- tea build/packaging config in the source (`Makefile`, `.drone.yml` / Gitea workflows, `docs/`).
- https://docs.gitea.com/installation/install-from-binary/ (official binary-install guidance).
- Verify empirically if possible: download the amd64 asset in this session, check `file`/`ldd` output, and run `tea --version` / `tea --help` on this host.

## Deliverable

Write findings to `research/tea-docker-install.md` (working tree; the map owner commits on `research/tea-codeberg`): a ready-to-paste candidate `RUN` block with an `ARG TEA_VERSION=<pinned>` pattern mirroring `BEADS_VERSION`, checksum verification, install to `/usr/local/bin`, and apt-list cleanup — every claim cited. Then add a `## Findings` section at the bottom of this ticket file and set `state: closed`.
