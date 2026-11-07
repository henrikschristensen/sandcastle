# Wayfinder map: support tea/codeberg (Gitea as an init issue tracker)

**Tracker:** published to GitHub — map [#15](https://github.com/henrikschristensen/sandcastle/issues/15) with tickets [#16](https://github.com/henrikschristensen/sandcastle/issues/16)–[#24](https://github.com/henrikschristensen/sandcastle/issues/24) in `henrikschristensen/sandcastle` (sub-issues, native blocked-by edges, `## Blocked by` body convention). This directory (`map.md` + `tickets/*.md` on branch `research/tea-codeberg`) is the canonical working copy; `publish-to-tracker.sh` mirrors it. Frontier query: list `tickets/`, keep `state: open`, drop any whose `blocked_by` slugs are not all `state: closed` (on GitHub: open sub-issues of #15 whose blockers are all closed). Claim a ticket by setting `assignee` before working. Originating request: `/wayfinder support tea/codeberg`.

## Destination

A fully decided, plan-only implementation spec for adding **Gitea issues** — Codeberg or any self-hosted Gitea — as a first-class **issue tracker** choice in `sandcastle init`, driven by the official first-party `tea` CLI (code.gitea.io/tea): an `ISSUE_TRACKER_REGISTRY` entry named `gitea` in `src/InitService.ts` (placed between `beads` and `custom`; `github-issues` stays the default), with `LIST_TASKS_COMMAND`/`VIEW_TASK_COMMAND`/`CLOSE_TASK_COMMAND` template args, a pinned `TEA_TOOLS` Dockerfile snippet, a `GITEA_SERVER_URL`/`GITEA_TOKEN` `.env.example`, tests in `src/InitService.test.ts`, `docs/guide/` updates, and a changeset — the full checklist in [docs/agents/adding-an-issue-tracker.md](../../docs/agents/adding-an-issue-tracker.md). The map is done when every ticket is closed: nothing left to decide before someone implements.

## Notes

- **Domain:** Sandcastle = TS library orchestrating AI coding agents in isolated sandboxes. Issue-tracker entries are scaffold templates: three CLI commands substituted into the generated prompts plus a Dockerfile snippet installing the CLI into the sandbox (see `src/InitService.ts`: `GITHUB_CLI_TOOLS`, `BEADS_TOOLS`, `ISSUE_TRACKER_REGISTRY`).
- **Skills:** decision (grilling) tickets consult `/grilling` + `/domain-modeling`; research tickets are resolved by `/research` subagents.
- **Source materials:**
  - `docs/agents/adding-an-issue-tracker.md` — the must-have CLI questionnaire, the `IssueTrackerEntry` shape, the implementation checklist.
  - `src/InitService.ts` — the registry entries for `github-issues` (label-filtered JSON list, GH_TOKEN/GH_HOST env, native-sandbox env note) and `beads` (pinned version, checksum-verified binary install, sandboxOptions) are the patterns to follow.
  - `src/templates/` — the scaffolded prompt files the template args land in.
  - tea CLI upstream: https://code.gitea.io/tea (source at https://gitea.com/gitea/tea, docs in `docs/CLI.md`).
- **Upstream caveat (from tickets 01/03):** tea's repo is archived upstream in favor of `gt` (gitea.com/gitea/cli), and Codeberg runs **Forgejo 17** (Gitea-compatible API). tea v0.16.0 still meets every must-have; the destination stays tea (grilled with the user), but pinning/longevity tickets should weigh the archival notice.
- **Scope decisions locked while charting (grilled with the user):**
  - Destination is the init issue-tracker integration only — not Codeberg-as-git-host.
  - Entry is a generic `gitea` entry (any Gitea instance); Codeberg is the documented default via `GITEA_SERVER_URL=https://codeberg.org`.
  - Plan-only: the map produces decisions; implementation is handed off.
  - Host/repo/auth: env vars in .env plus the repo derived from the sandbox's `git remote get-url origin` via a prompt shell expression; no new init questions.
  - `LIST_TASKS_COMMAND` filters the `Sandcastle` label and emits JSON, mirroring github-issues.
  - Registry placement: after `beads`, before `custom`; `github-issues` remains the default `[0]`. Name `gitea`, label like "Gitea (Codeberg or self-hosted)".

## Decisions so far

<!-- one line per closed ticket: gist of the answer + link to the ticket -->

- [Research: tea CLI capability audit against the issue-tracker must-haves](tickets/01-tea-cli-capabilities.md) — tea v0.16.0 meets every must-have. List: `tea issues list --state open --labels Sandcastle --limit 100 -o json` (all JSON values are strings; `index` needs `tonumber` in jq). View: `tea issues <ID> --comments -o json`. Close: `tea issues close <ID>` (no comment flag) plus a separate `tea comments add <ID> "…"`. Auth is pure env vars: `GITEA_INSTANCE_URL` + `GITEA_TOKEN` build an in-memory login with the version check auto-disabled (the `GITEA_SERVER_*` names only feed `tea login add`). Repo is auto-detected from the branch's git remote (https/ssh/subpaths/ports; `-r owner/repo` overrides). Exit codes 0/1. Label filters are OR; unknown labels are silently dropped — use a single label. Findings: `research/tea-cli-capabilities.md`.
- [Research: installing a pinned tea release in a Debian sandbox image (assets, checksums, Dockerfile RUN block)](tickets/02-tea-docker-install.md) — Pin `v0.16.0` (2026-09-10). Assets are **bare binaries** `tea-0.16.0-linux-amd64(.xz)` (+ `.sha256` sidecars) from `gitea.com/gitea/tea/releases/download/vX.Y.Z/` (byte-identical mirror `dl.gitea.com/tea/X.Y.Z/`), with a standard `checksums.txt` that works with the beads `grep … | sha256sum -c -` pattern. The binary is fully static (`CGO_ENABLED=0`; `ldd` → not dynamic), so no runtime apt deps and bookworm's glibc is irrelevant; no apt package exists (bookworm's `tea` is the unrelated TEA text editor). Candidate single `RUN` block with `ARG TEA_VERSION=0.16.0` is in the doc; sanity check is `tea --version`. Findings: `research/tea-docker-install.md`.
- [Research: Codeberg.org token creation, scopes, and Gitea specifics the scaffold depends on](tickets/03-codeberg-token-scopes.md) — Codeberg runs Forgejo 17 (Gitea-compatible). API base `https://codeberg.org/api/v1`. Token: profile → Settings → Applications → New access token, **minimum scopes `read:issue` + `write:issue`** for list/view-with-comments/close-with-comment; token shown once; repo-access selector available. Labels filter server-side (`?labels=…`). No published numeric quota — fair use with 429 rate limiting (10-min windows). Proposed `.env.example` comment text is §8 of the doc. Findings: `research/codeberg-token-scopes.md`.
- [Decide: host, repo and auth wiring (.env.example vars + git-repo resolution)](tickets/04-host-repo-auth-wiring.md) — Locked: `.env.example` ships `GITEA_INSTANCE_URL=https://codeberg.org` + `GITEA_TOKEN=` (tea's runtime env login; in-memory, version check auto-off; no `tea login add` step). Repo is resolved by **tea's native git-remote auto-detection** — no shell expression in the command strings; `-r owner/repo` is the documented override. `GITEA_INSTANCE_URL` is authoritative when the remote host differs. Native providers get an `envNotes` line mirroring github-issues (put `GITEA_TOKEN` in `.sandcastle/.env`).
- [Decide: exact LIST/VIEW/CLOSE command strings for the gitea entry](tickets/05-list-view-close-commands.md) — Locked: LIST `tea issues list --state open --labels Sandcastle --limit 100 --fields index,title,state,labels,body,url -o json` (raw JSON, no jq pipe), VIEW `tea issues <ID> --comments -o json`, CLOSE `tea comments add <ID> "Completed by Sandcastle" && tea issues close <ID>`; `<ID>` = issue index; bare commands relying on 04's auto-detection; `Sandcastle` label kept (07 extends `--create-label`/strip to the `--labels` spelling, 08 documents label creation).
- [Decide: TEA_TOOLS Dockerfile snippet and tea version pinning policy](tickets/06-tea-tools-dockerfile-pin.md) — Locked: pin `TEA_VERSION = "0.16.0"` const + overridable `ARG TEA_VERSION` (beads pattern); `TEA_TOOLS` is the research §5 block verbatim — single RUN, `tea-…-linux-${ARCH}.xz` from gitea.com releases, `checksums.txt` grep + `sha256sum -c`, install to `/usr/local/bin/tea`, `tea --version` sanity; static binary so no runtime deps; **no drift warning** (tea keeps no shared local state, unlike bd).

## Not yet specified

<!-- in-scope fog; graduates as the frontier advances -->

- Empirical end-to-end run of the locked commands and env vars against a real Codeberg repo needs a token/test repo the user provisions (09).

## Out of scope

<!-- ruled beyond the destination; never graduates -->

- Gitea/Codeberg as a git host for push/PR/clone from sandboxes.
- tea pull-request management (`tea pr …`).
- MCP-server-only integrations.
- Changes to the `custom` tracker flow / SETUP_ISSUE_TRACKER.md.
- Switching the scaffold to `gt` (gitea/cli, tea's archived successor) instead of tea — the destination is tea, grilled with the user.
