---
title: "Research: tea CLI capability audit against the issue-tracker must-haves"
type: research
state: closed
assignee: henrikschristensen
blocked_by: []
---

## Question

Does the official first-party `tea` CLI (code.gitea.io/tea) satisfy every must-have in `docs/agents/adding-an-issue-tracker.md` for unattended use inside a Debian sandbox, and what are the exact command strings? Specifically:

- (a) Non-interactive **list** of open issues in the current repo, filterable by label, with JSON output — exact subcommand and flags (`tea issue list …`? `--state open`? `--labels`? `-o json` / `--output json`?), and the JSON field names the scaffolded prompt would jq.
- (b) Non-interactive **view** of one issue by number, including its comments — exact command and flags.
- (c) Non-interactive **close** of one issue by number, ideally with a closing comment — exact command and flags.
- (d) **Auth from env vars**: does tea read a token directly from an env var (which name — `GITEA_TOKEN`?), or only via `tea login add --token …` persisted to `$XDG_CONFIG_HOME/tea`? Which env vars does it honor (`GITEA_SERVER_URL`? others)? Can a one-shot `tea login add --name … --url … --token …` run non-interactively inside a fresh sandbox (no TTY)?
- (e) **Repo auto-detection** from the `$PWD` git remote: which remote does it pick when several exist, and which URL forms does it parse (https `https://host/owner/repo(.git)`, ssh `git@host:owner/repo(.git)`, ssh:// URLs, nonstandard ports, subpaths)? What is the `--repo`/`-r` override's exact slug format?
- (f) **Exit codes** on success vs failure (bad token, missing issue, network error).
- (g) The **server version check**: on by default? Does it hit the network on every command, and how is it disabled (flag, config key, env var) so unattended runs don't stall or fail against old Gitea versions?
- (h) **Label filter semantics** on list: comma-separated multiple labels? AND or OR?

## Sources (primary only)

- https://code.gitea.io/tea and its source mirror https://gitea.com/gitea/tea — `docs/CLI.md`, README, `main.go`, `modules/cmd/…` (issue list/view/close, login), `modules/config…`, `modules/context…` (repo auto-detection), version-check code.
- If a `tea` binary can be installed locally in this session (download a release from code.gitea.io/tea/releases or gitea.com/gitea/tea/releases), run `tea --help`, `tea issue list --help`, `tea login add --help` and capture real output.
- Gitea API docs for the issues endpoints (https://docs.gitea.com/development/api-usage or the swagger at codeberg.org/api/swagger).

## Deliverable

Write findings to `research/tea-cli-capabilities.md` (working tree; the map owner commits on the throwaway branch `research/tea-codeberg`): every claim cited to its source, plus a proposed mapping to `LIST_TASKS_COMMAND` / `VIEW_TASK_COMMAND` / `CLOSE_TASK_COMMAND` (with the literal `<ID>` placeholder), including the auth mechanism and version-check disable chosen for unattended sandboxes. Then add a `## Findings` section at the bottom of this ticket file pointing at the doc, and set `state: closed`.

## Findings

Full audit in [`research/tea-cli-capabilities.md`](../../../research/tea-cli-capabilities.md) (tea v0.16.0, source gitea.com/gitea/tea @ `397e630`; every claim cited to source files/lines plus runs of the real binary against a fake Gitea API). Key facts:

- **List:** `tea issues list --state open --labels Sandcastle --limit 100 -o json` — `--state` defaults to `open`; `--labels/-L` is CSV; `-o json` emits an array whose keys are the field names with **all values as strings** (`index` needs `tonumber` in jq). Default fields: `index,title,state,author,milestone,labels,owner,repo`.
- **View:** `tea issues <ID> --comments -o json` (bare `tea issues <ID>` is the view command; JSON embeds `comments` only with `--comments`; no TTY prompt when piped).
- **Close:** `tea issues close <ID>` (no comment flag); closing comment is a separate `tea comments add <ID> "…"` first.
- **Auth:** pure env vars work unattended with no config/TTY: `GITEA_INSTANCE_URL` + `GITEA_TOKEN` (fallback `GH_TOKEN`, plus `GITEA_INSTANCE_SSH_HOST`, `GITEA_INSTANCE_INSECURE`). Note `GITEA_SERVER_URL`/`GITEA_SERVER_TOKEN` only feed `tea login add` flags; `tea login add --name … --url … --token …` is non-interactive when flags are given (writes `$XDG_CONFIG_HOME/tea/config.yml`, 0600) but validates the token over the network once.
- **Repo detection:** from `$PWD` git remote — branch main/master/trunk's remote, else `upstream`, else `origin`; parses https/http (prefix match, last two path segments, subpaths+ports OK), scp-style `git@host:o/r(.git)`, `ssh://` (port-insensitive). `-r/--repo owner/repo` overrides (single name → login user as owner; existing dir path → local repo).
- **Exit codes:** 0 on success, 1 on any error (bad token, 404, network, no login) — verified empirically.
- **Version check:** on by default for `login add` logins (one lazy `GET /api/v1/version` per process); disabled via env login (automatic `VersionCheck: false`), `--no-version-check`/`-nv`, or `version_check: false` in config — verified no `/version` call when disabled.
- **Labels:** comma-separated, **OR** semantics server-side ("any of these labels"; unknown labels discarded) — use a single label for the ready filter.
- **Caveat:** upstream announced tea is replaced by `gt` (gitea.com/gitea/cli) and the repo will be archived (commit `397e630`, PR #1155).

Proposed mapping (in the research doc): `LIST_TASKS_COMMAND: "tea issues list --state open --labels Sandcastle --limit 100 -o json"`, `VIEW_TASK_COMMAND: "tea issues <ID> --comments -o json"`, `CLOSE_TASK_COMMAND: "tea issues close <ID>"` (optionally preceded by `tea comments add <ID> "…"`), with `.env.example` carrying `GITEA_INSTANCE_URL` + `GITEA_TOKEN`.
