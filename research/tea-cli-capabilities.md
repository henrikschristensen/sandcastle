# tea CLI capability audit vs. the issue-tracker must-haves

Ticket: `plans/tea-codeberg/tickets/01-tea-cli-capabilities.md`

**Date:** 2026-11-07. **CLI under test:** `tea v0.16.0` (latest release, published 2026-09-10), source at commit `397e6300ec93937b7745ebcc19b95ca9cb30568b` (2026-10-29) of https://gitea.com/gitea/tea (canonical home `code.gitea.io/tea` 302-redirects there). Must-haves audited against: `docs/agents/adding-an-issue-tracker.md`.

**Headline caveat:** upstream has announced that **tea is replaced by `gt`** (https://gitea.com/gitea/cli) and this repo "will be archived" — README notice added in commit `397e630` ("docs: announce that tea is replaced by gt (#1155)", PR https://gitea.com/gitea/tea/pulls/1155), migration guide at https://gitea.com/gitea/cli/src/branch/main/docs/migrating-from-tea.md. tea still meets every must-have below and releases are still published, but longevity should factor into the integration decision.

## Sources

- **[T]** tea source, shallow clone of https://gitea.com/gitea/tea @ `397e630` — cited as `tea/<path>:<line>`.
- **[T-bin]** Real binary `tea-0.16.0-linux-amd64` from https://gitea.com/gitea/tea/releases/download/v0.16.0/tea-0.16.0-linux-amd64 (`tea --version` → `Version: 0.16.0  golang: 1.26.6  go-sdk: v1.2.0`). All `--help` output and exit codes below were captured from this binary on 2026-11-07.
- **[T-emp]** Empirical runs of the v0.16.0 binary against a local fake Gitea API (python `http.server` on 127.0.0.1:8899 logging every request path) and against `https://codeberg.org` with a dummy (non-real) token string. Request paths and JSON output quoted verbatim. No real token was used, created, or read; the config file written during testing contained only the dummy string.
- **[SDK]** go-sdk, https://gitea.com/gitea/go-sdk @ main — cited as `sdk/gitea/<file>:<line>`.
- **[GS]** Gitea server, https://github.com/go-gitea/gitea @ main (gitea.com/gitea/gitea is an archived 2020 placeholder; go-gitea/gitea on GitHub is the live repo, pushed 2026-11-07) — cited as `gitea/<path>:<line>`.

## (a) Non-interactive list with label filter + JSON

Exact command (verified via `tea issues list --help` [T-bin] and `tea/docs/CLI.md:176` [T]):

```
tea issues list --state open --labels Sandcastle --limit 100 -o json
```

- Subcommand: `tea issues list` (aliases: `issues ls`, `issue list`, `i list`) — `tea/cmd/issues/list.go:26-34` [T]; `tea issues` with no args also lists (`tea/cmd/issues.go:85-90`).
- `--state` accepts `all|open|closed`, **default `open`** — `tea/cmd/flags/issue_pr.go:16-21` and `tea/cmd/flags/generic.go:170-179` (`ParseState("")` → open) [T]; help shows `(default: open)` [T-bin]. So `--state open` is optional but explicit is better for prompts.
- `--labels` / `-L`: CSV flag — `tea/cmd/flags/issue_pr.go:35-39` [T]. Sent as one comma-joined query param: SDK `ListIssueOption.Labels []string` → `query.Add("labels", strings.Join(opt.Labels, ","))` — `sdk/gitea/issue.go:65,120-122` [SDK]. Empirically: `--labels bug,ready` produced `GET /api/v1/repos/alice/widgets/issues?labels=bug%2Cready&limit=30&milestones=&page=1&state=open&type=issues` [T-emp].
- Other list filters: `--keyword/-k`, `--kind/-K`, `--milestones/-m`, `--author/-A`, `--assignee/-a`, `--mentions/-M`, `--owner/--org`, `--from/-F`, `--until/-u`, `--page/-p` (default 1), `--limit/--lm` (default 30) — `tea/cmd/flags/issue_pr.go:48-90`, `tea/cmd/flags/generic.go:64-78` [T]. `--limit -1` is not allowed for page but limit 0 → default 30; to get "all", paginate or set a high `--limit`.
- `--output/-o` accepts `simple, table, csv, tsv, yaml, json` — `tea/cmd/flags/generic.go:36-41` [T]; `tea/modules/print/table.go:80-98`.
- `--fields/-f` selects printed fields; available: `index,state,kind,author,author-id,url,title,body,created,updated,deadline,assignees,milestone,labels,comments,owner,repo`; default `index,title,state,author,milestone,labels,owner,repo` — `tea/cmd/issues/list.go:22-27`, `tea/modules/print/issue.go:53-69` [T].

**JSON shape (captured from the real binary, [T-emp]):** an array of objects whose keys are the selected field names, snake_cased (`author-id` → `author_id`), and **every value is a JSON string** (the table printer marshals `map[string]string` — `tea/modules/print/table.go:187-228`). Default fields gave:

```json
[
  {
    "index": "5",
    "title": "Fix the widget",
    "state": "open",
    "author": "alice",
    "milestone": "",
    "labels": "bug",
    "owner": "alice",
    "repo": "widgets"
  }
]
```

jq note for the scaffolded prompt: `.[] | {index: (.index | tonumber), title, labels: (.labels | split(" "))}` — `index` must be `tonumber`'d; `labels` is space-separated in list output (machine-readable mode joins formatted label names with a space — `tea/modules/print/issue.go:138-144`). Add `--fields ...,body,url,comments` if the prompt needs the body.

## (b) Non-interactive view of one issue, incl. comments

Exact command (verified [T-bin], `tea/cmd/issues.go:52-90`):

```
tea issues <ID> --comments -o json     # machine-readable, comments included
tea issues <ID> --comments              # human-readable, comments printed
```

- `tea issues <index>` (aliases `issue`, `i`) with one positional arg shows the issue in detail (`tea/cmd/issues.go:85-90`, `runIssueDetail`).
- `--comments` flag on `tea issues` (line 69-72): in JSON mode, comments are fetched and embedded **only if `--comments` is set** (`runIssueDetailAsJSONWithClient`, `tea/cmd/issues.go:146-161` — `if ctx.Bool("comments")`). In text mode, `interact.ShowCommentsMaybeInteractive` prints comments when `--comments` is set and does **not** prompt when stdout is not a TTY (`tea/modules/interact/comments.go:24-40`) — safe unattended.
- Captured JSON from the real binary [T-emp] — keys from the `issueData` struct (`tea/cmd/issues.go:24-38`):

```json
{
  "id": 101,
  "index": 5,
  "title": "Fix the widget",
  "state": "open",
  "created": "2026-01-01T00:00:00Z",
  "labels": [{ "name": "bug", "color": "ff0000", "description": "" }],
  "user": "alice",
  "body": "widget is broken",
  "assignees": [],
  "url": "https://host/alice/widgets/issues/5",
  "closedAt": null,
  "comments": [
    {
      "id": 55,
      "author": "bob",
      "created": "2026-01-03T00:00:00Z",
      "body": "looks good"
    }
  ]
}
```

Here `id`/`index`/`comments[].id` are real JSON numbers; `labels` is an array of objects. There is no separate `tea issues view` subcommand — the bare `tea issues <ID>` form is the view command (`tea/docs/CLI.md:126-128`).

## (c) Non-interactive close, with a closing comment

```
tea issues close <ID>                                  # close only
tea comments add <ID> "closing comment" && tea issues close <ID>   # comment + close
```

- `tea issues close <index> [<index>...]` — `tea/cmd/issues/close.go:19-29`; it PATCHes `EditIssueOption{State: closed}` via the API (`editIssueState`, lines 32-63). **It takes no comment flag** (help output [T-bin] lists only `--repo/--remote/--login/--output`). Requires repo context (`Ensure(RemoteRepo: true)`, line 38).
- Closing comment is a separate command: `tea comments add <index> "<body>"` (aliases `comment`, `c`; shorthand `tea comments <index> "<body>"`) or `--description/-d`; body can also come from piped stdin. If the body is empty and stdin is not piped it opens an interactive editor — always pass the body or pipe stdin in unattended use (`tea/cmd/comments/add.go:27-46,66-80`, `tea/cmd/comment.go:16-29`). Empirically the POST went to `/api/v1/repos/alice/widgets/issues/5/comments` [T-emp].
- `tea issues edit <ID>` exists but has no comment field either (flags are title/description/labels/assignees/milestone/... — `tea/cmd/flags/issue_pr.go:192-215`).
- Close output: prints the closed issue (single index) or its HTML URL (multiple) — `tea/cmd/issues/close.go:55-61`. Exit 0 on success [T-emp].

## (d) Auth from env vars vs `tea login add`

Two mechanisms, both non-interactive-capable:

1. **Pure env-var login (recommended for sandboxes)** — `tea/modules/context/context_login.go:15-51` (`GetLoginByEnvVar`):
   - `GITEA_TOKEN` — access token (line 18); `GH_TOKEN` is accepted as a fallback (line 19).
   - `GITEA_INSTANCE_URL` — **required** together with a token; if either is missing, no env login is created (lines 33-36).
   - `GITEA_INSTANCE_SSH_HOST` (line 21), `GITEA_INSTANCE_INSECURE` (bool, line 22) — optional.
   - Builds an in-memory login named `GITEA_LOGIN_VIA_ENV` with **`VersionCheck: false`** (line 49) — see (g). It is always preferred when set (`tea/modules/context/context.go:124-131,146-148`) and is matched first against git remotes (prepended to the login list, `tea/modules/context/context_repo.go:67-70`). Empirically, `GITEA_TOKEN=<dummy> GITEA_INSTANCE_URL=https://codeberg.org tea issues list --repo codeberg/forgejo-docs` issued the API request directly, no config file, no TTY [T-emp].
2. **`tea login add`** — `tea/cmd/login/add.go:31-171`:
   - Flags: `--name/-n`, `--url/-u` (env **`GITEA_SERVER_URL`**, default `https://gitea.com`), `--token/-t` (env **`GITEA_SERVER_TOKEN`**), `--user` (`GITEA_SERVER_USER`), `--password/--pwd` (`GITEA_SERVER_PASSWORD`), `--otp` (`GITEA_SERVER_OTP`), `--scopes` (`GITEA_SCOPES`), `--no-version-check/--nv`, `--insecure/-i`, `--oauth/-o` (interactive browser flow), `--git-credentials/--helper/-j` — all visible in `tea login add --help` [T-bin].
   - **Non-interactive when any flag is given**: `runLoginAdd` goes interactive only when `cmd.NumFlags() == 0` (`tea/cmd/login/add.go:121-127`). Verified: `tea login add --name test --url http://127.0.0.1:8899 --token <dummy> < /dev/null` exited 0 with no TTY [T-emp]. Note it does make **one network call** to validate the token and fetch the username (`GetMyUserInfo`, `tea/modules/task/login_create.go:137-142`), so the instance must be reachable at setup time.
   - Persists to **`$XDG_CONFIG_HOME/tea/config.yml`** (fallback `~/.tea/tea.yml`), written mode `0600` — `tea/modules/config/config.go:49-80,150-157`. Captured file (dummy token) [T-emp]: `logins: [{name: test, url: ..., token: ..., version_check: true, user: alice, ...}]`.
   - Note the env-var names differ per mechanism: runtime env login reads `GITEA_INSTANCE_URL`/`GITEA_TOKEN`; `tea login add`'s flags read `GITEA_SERVER_URL`/`GITEA_SERVER_TOKEN`. For `.env.example`, ship `GITEA_INSTANCE_URL` + `GITEA_TOKEN` (used at runtime, no setup step); optionally also the `GITEA_SERVER_*` pair if the Dockerfile ever runs `tea login add`.

## (e) Repo auto-detection from the git remote; `--repo` override

- Detection runs against the git repo at `$PWD` (or the `--repo` value if it is an existing directory path) — `tea/modules/context/context.go:103-143`. The sandbox's mounted repo is a normal git clone, so detection works there; `--repo owner/repo` works even outside a repo.
- **Which remote** when several exist (`tea/modules/context/context_repo.go:30-56`): the remote of branch `main`, else `master`, else `trunk`; if none of those branches exists: `upstream` if present, else `origin`, else an arbitrary first remote. Overridable with `--remote/-R` or config `preferences.flag_defaults.remote`. Empirically, a repo with `origin` (https) + `upstream` (ssh) and `branch.main.remote=upstream` resolved the ssh upstream URL [T-emp]; with `branch.main.remote=origin` it resolved origin [T-emp].
- **URL forms** parsed (`tea/modules/context/context_remote.go:18-58` `MatchLogins` + `tea/modules/git/url.go:17-53`):
  - `https://host/owner/repo(.git)` and `http://…` — matched when the remote URL has the login URL as prefix; slug = **last two path segments** (so subpath-hosted instances work if the login URL includes the subpath; `.git` trimmed). Empirically `http://127.0.0.1:8899/gitea/sub/alice/widgets.git` + `GITEA_INSTANCE_URL=http://127.0.0.1:8899/gitea` → slug `alice/widgets`, API called under the `/gitea` prefix [T-emp].
  - scp-like `git@host:owner/repo(.git)` — matched when the part between `@` and `:` equals the login's SSH host (derived from the login URL's host, `tea/modules/config/login.go:535-544`).
  - `ssh://git@host[:port]/owner/repo(.git)` — matched on host, **port-insensitive** (`p.Host` or `p.Hostname()`); empirically `ssh://git@codeberg.org:2222/acme/portproj.git` matched login URL `https://codeberg.org` → slug `acme/portproj` [T-emp]. `git+ssh://` is normalized to `ssh` (`tea/modules/git/url.go:44-46`).
  - Nonstandard ports on http(s) remotes work the same way (prefix match includes the port). Bare `host/owner/repo` (no scheme) is treated as `https://` only when it has exactly two `/` and no `:` (`tea/modules/git/url.go:26-33`).
- `--repo`/`-r` override (`tea/cmd/flags/generic.go:24-28`): value is treated as a **local path** if it is an existing directory, otherwise as a slug `owner/repo`; a single `repo` segment falls back to the login's username as owner (`tea/modules/utils/parse.go:40-49`). Empirically `--repo otherorg/otherrepo` → `/api/v1/repos/otherorg/otherrepo/issues` [T-emp]. If no repo context can be resolved, list falls back to a global search (`GET /repos/issues/search`) but view/close fail with "remote repository required" (`tea/modules/context/context_require.go:18-21`).

## (f) Exit codes

`tea/main.go:21-31`: success → exit **0** (including an explicit interactive cancel, `ErrCommandCanceled` → 0); **any** error → `Error: <msg>` on stderr and exit **1** (urfave/cli `ExitCoder`s exit with their own code, but tea's own errors are all generic → 1). Empirically [T-emp]: bad token → `Error: token is malformed…` exit 1; missing issue → `Error: not found: /api/v1/repos/alice/widgets/issues/999` exit 1; no login configured → `Error: no available login` exit 1; successful list/view/close → exit 0. So "non-zero on error" must-have is met.

## (g) Server version check: default, cost, how to disable

- Per-login config field `version_check` (yaml, `tea/modules/config/login.go:60`). **Default on** for `tea login add` (`versionCheck = !cmd.Bool("no-version-check")`, `tea/cmd/login/add.go:168`); captured config shows `version_check: true` [T-emp].
- When enabled, the SDK lazily issues one extra `GET <server>/api/v1/version` per process on the first version-gated API call (`sdk/gitea/version.go:166-183` `checkServerVersionGreaterThanOrEqual` → `loadServerVersion` → `getServerVersionResponse`, `sdk/gitea/version.go:22-24`), then caches it in-process. Empirically, with a `version_check: true` config login the request log showed `/api/v1/repos/alice/widgets/issues?…` **and** `/api/v1/version` [T-emp]. If the version endpoint fails, tea only prints a warning and continues (`tea/modules/config/login.go:500-508`).
- **Disable options:** (1) use the env-var login — it hard-codes `VersionCheck: false` (`tea/modules/context/context_login.go:49`); (2) `tea login add --no-version-check` / `-nv` (`tea/cmd/login/add.go:48-52`); (3) set `version_check: false` in `$XDG_CONFIG_HOME/tea/config.yml`. When disabled, tea passes `gitea.SetGiteaVersion("")` which sets SDK `ignoreVersion` and skips **all** version network calls (`tea/modules/config/login.go:474-476`, `sdk/gitea/version.go:107-116`). Empirically, env login and a `--no-version-check` login produced **no** `/api/v1/version` request [T-emp]. There is no global flag/env for the version check — for unattended sandboxes, the env-var login is the clean choice since it disables the check implicitly.

## (h) Label filter semantics: OR, not AND

`--labels a,b` is CSV-split by tea and re-joined into a single `labels=a,b` query param (`sdk/gitea/issue.go:120-122`). Server side (Gitea/Forgejo API), the swagger for `GET /repos/{owner}/{repo}/issues` states: _"comma separated list of label names. Fetch only issues that have **any of** this label names. Non existent labels are discarded."_ — `gitea/routers/api/v1/repo/issue.go:271-273` (and :47-49), implemented via `GetLabelIDsInRepoByNames` → `IncludedAnyLabelIDs` (`gitea/routers/api/v1/repo/issue.go:335-341,193`). **So multiple labels are OR'd**, and unknown labels are silently dropped (an all-unknown list returns _all_ issues of the repo in that state). For a "ready" filter, use a single label (e.g. `--labels Sandcastle`), exactly like the github-issues entry does.

## Verdict vs. the must-haves in docs/agents/adding-an-issue-tracker.md

| Must-have                           | Met?              | Evidence                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official/first-party CLI            | Yes, with caveat  | gitea.com/gitea/tea, MIT, maintained by The Gitea Authors; **but superseded by `gt`, repo to be archived** (commit `397e630`)                                                                                                                                                                                                         |
| Non-interactive auth via env var    | Yes               | `GITEA_INSTANCE_URL` + `GITEA_TOKEN` (fallback `GH_TOKEN`), `GITEA_INSTANCE_SSH_HOST`, `GITEA_INSTANCE_INSECURE` — `tea/modules/context/context_login.go:15-51`; no TTY, no config file [T-emp]. `.env.example` should carry `GITEA_INSTANCE_URL`/`GITEA_TOKEN` (not just the `GITEA_SERVER_*` pair, which only feed `tea login add`) |
| Non-interactive list                | Yes               | `tea issues list --state open --labels <label> --limit 100 -o json` (a, above)                                                                                                                                                                                                                                                        |
| Non-interactive view incl. comments | Yes               | `tea issues <ID> --comments -o json` (b, above)                                                                                                                                                                                                                                                                                       |
| Non-interactive close, with comment | Yes, two commands | `tea issues close <ID>`; comment via `tea comments add <ID> "…"` first (c, above)                                                                                                                                                                                                                                                     |
| Installable in a Debian container   | Yes               | single static binary per release, e.g. `tea-0.16.0-linux-amd64` (+ `.xz`, `.sha256`) from https://gitea.com/gitea/tea/releases — one `curl` + `install` in a Dockerfile `RUN` (pinning details are ticket 02/06)                                                                                                                      |
| Stable exit codes                   | Yes               | 0 success, 1 on any error (bad token/404/network/no login) — `tea/main.go:21-31` [T-emp]                                                                                                                                                                                                                                              |
| Structured JSON list (preferred)    | Yes               | `-o json`; keys = field names, **all values strings** — `tea/modules/print/table.go:210-229`; default fields `index,title,state,author,milestone,labels,owner,repo` [T-emp]                                                                                                                                                           |
| Label filter on list (preferred)    | Yes, OR semantics | `--labels/-L` CSV → `labels=a,b` query; server matches issues with **any** label, unknown labels discarded — `gitea/routers/api/v1/repo/issue.go:271-273`                                                                                                                                                                             |

## Proposed mapping for `IssueTrackerEntry` (name `gitea`)

Run inside the sandbox's repo checkout (remote auto-detection), or append `-r owner/repo` explicitly:

```ts
templateArgs: {
  // open issues carrying the "Sandcastle" label, as JSON (values are strings: .index | tonumber)
  LIST_TASKS_COMMAND: "tea issues list --state open --labels Sandcastle --limit 100 -o json",
  // one issue incl. comments, as JSON
  VIEW_TASK_COMMAND: "tea issues <ID> --comments -o json",
  // close (comment is a separate command; use both lines if a closing comment is wanted):
  //   tea comments add <ID> "Closed by sandcastle" && tea issues close <ID>
  CLOSE_TASK_COMMAND: "tea issues close <ID>",
}
envExample: `# Gitea instance and access token (Codeberg: https://codeberg.org)
GITEA_INSTANCE_URL=https://codeberg.org
GITEA_TOKEN=`,
```

- **Auth mechanism for unattended sandboxes:** env-var login only (`GITEA_INSTANCE_URL` + `GITEA_TOKEN`); no `tea login add` step, no config file, no TTY. This also implicitly disables the server version check (`VersionCheck: false`).
- **Version-check disable chosen:** rely on the env login's built-in `VersionCheck: false`; if a config-file login is ever used instead, add `--no-version-check` (`-nv`) to `tea login add` (or `version_check: false` in `config.yml`). Verified: no `GET /api/v1/version` in either case [T-emp].
- **Repo context:** rely on `$PWD` git-remote auto-detection inside the sandbox (remote of `main`/`master`/`trunk`, else `upstream`, else `origin`; https, scp-ssh, ssh://, ports and subpaths all handled), with `-r owner/repo` as the explicit fallback.
- **Label filter:** single `--labels Sandcastle`; remember multi-label is OR and unknown labels are silently ignored, so a typo'd label widens (not narrows) the result.
- **jq gotcha:** list JSON values are strings — `tonumber` the `index`; view JSON has numeric `id`/`index` and a `comments` array only with `--comments`.
