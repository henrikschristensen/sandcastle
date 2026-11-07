---
title: "Research: tea CLI capability audit against the issue-tracker must-haves"
type: research
state: open
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
