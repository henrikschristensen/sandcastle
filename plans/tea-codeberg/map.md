# Wayfinder map: support tea/codeberg (Gitea as an init issue tracker)

**Tracker:** local-markdown fallback — the GitHub App token in this session is read-only (403 on issue writes), so per the wayfinder skill the map and its tickets live in this directory: `map.md` plus `tickets/*.md`. `publish-to-tracker.sh` mirrors them to the GitHub issue tracker once a `gh` token that can create issues is available. Frontier query: list `tickets/`, keep `state: open`, drop any whose `blocked_by` slugs are not all `state: closed`. Claim a ticket by setting `assignee` before working. Originating request: `/wayfinder support tea/codeberg`.

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
- **Scope decisions locked while charting (grilled with the user):**
  - Destination is the init issue-tracker integration only — not Codeberg-as-git-host.
  - Entry is a generic `gitea` entry (any Gitea instance); Codeberg is the documented default via `GITEA_SERVER_URL=https://codeberg.org`.
  - Plan-only: the map produces decisions; implementation is handed off.
  - Host/repo/auth: env vars in .env plus the repo derived from the sandbox's `git remote get-url origin` via a prompt shell expression; no new init questions.
  - `LIST_TASKS_COMMAND` filters the `Sandcastle` label and emits JSON, mirroring github-issues.
  - Registry placement: after `beads`, before `custom`; `github-issues` remains the default `[0]`. Name `gitea`, label like "Gitea (Codeberg or self-hosted)".

## Decisions so far

<!-- one line per closed ticket: gist of the answer + link to the ticket -->

_(none yet)_

## Not yet specified

<!-- in-scope fog; graduates as the frontier advances -->

- Exact JSON shape of `tea issue list` output and the jq shaping the scaffolded prompt needs (graduates from 01).
- Whether tea can authenticate in an unattended sandbox purely from env vars, or needs a `tea login add` config step (graduates into 04).
- tea's server version-check behavior and how to disable it for unattended runs (graduates from 01 into 04/05).
- Exact tea release asset names and checksums for the Dockerfile snippet (graduates from 02 into 06).
- Codeberg token scope names and any Codeberg-specific quirks the scaffold depends on (graduates from 03 into 04).
- Whether a host-tea vs image-tea drift warning is ever needed (expected: no — tea keeps no shared local state; the beads warning exists because bd owns the database) — decided in 06.
- Empirical end-to-end run of the locked commands needs a Codeberg token/test repo the user provisions (09).

## Out of scope

<!-- ruled beyond the destination; never graduates -->

- Gitea/Codeberg as a git host for push/PR/clone from sandboxes.
- tea pull-request management (`tea pr …`).
- MCP-server-only integrations.
- Changes to the `custom` tracker flow / SETUP_ISSUE_TRACKER.md.
