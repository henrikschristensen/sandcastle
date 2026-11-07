# Empirical verification of the locked tea commands (wayfinder ticket 09)

**Date:** 2026-11-07. **CLI:** `tea v0.16.0` (binary from gitea.com/gitea/tea/releases). **Server:** local **Forgejo 17.0.1** (`forgejo-17.0.1-linux-amd64`, the same major version Codeberg runs) on `http://127.0.0.1:3100`, sqlite, admin user + `all`-scopes token created via `forgejo admin user`.

**Why local Forgejo instead of Codeberg:** the host's saved Codeberg token (`~/.config/tea/config.yml`, user `hsctech`) has issue scopes but not `write:user`, so no test repo could be created on Codeberg; a local Forgejo gives full control and is the same software Codeberg runs. (One probe issue #58 was created and immediately closed on `hsctech/nats-mq` while testing token scopes.)

## Setup

- Repo `empir/sandcastle-tea-test` (public, auto-init), cloned over http to `/tmp/tea-clone` (remote `http://127.0.0.1:3100/empir/sandcastle-tea-test.git` — exercises port + http remote parsing).
- Issue #1 "Test issue A" labeled `Sandcastle` (label id 1, color F9A825) with one comment; issue #2 "Test issue B" unlabeled.
- Sandbox-faithful env: `XDG_CONFIG_HOME` pointed at an **empty** dir (no tea config file), pure env login `GITEA_INSTANCE_URL=http://127.0.0.1:3100` + `GITEA_TOKEN=<local token>` — exactly what the scaffold ships (ticket 04).

## Results — the locked commands from ticket 05, run verbatim, bare (no `-r`), from the clone

1. **LIST** `tea issues list --state open --labels Sandcastle --limit 100 --fields index,title,state,labels,body,url -o json` → exit 0, JSON array with **only issue #1** (label filter works; unlabeled #2 excluded). All values are strings (`"index": "1"`, `"labels": "Sandcastle"`); `body` and `url` present thanks to `--fields`. Repo auto-detected from the git remote — no flags needed.
2. **VIEW** `tea issues 1 --comments -o json` → exit 0, full issue object with `labels` as array of objects and the `comments` array embedded (comment present). `index`/`id` are real JSON numbers here, unlike list.
3. **CLOSE** `tea comments add 1 "Completed by Sandcastle" && tea issues close 1` → exit 0; comment posted, issue closed (output shows the comment and `(closed)`).
4. **LIST after close** → `[]`, exit 0 (closed issue gone from the open+label view).

## Failure cases (exit codes as required by the must-haves)

- Bad token → `Error: access token does not exist …` on stderr, **exit 1**.
- Missing issue (`tea issues 999 --comments -o json`) → `Error: IsErrIssueNotExist`, **exit 1**.
- No repo context (run in `/tmp`, not a clone): **list** degrades to a global search and exits **0** (`[]` here); **view/close** fail with `Error: remote repository required: specify id via --repo or execute from a local git repo`, **exit 1**. Matches the behavior documented in `research/tea-cli-capabilities.md` (e) — this is why ticket 07's next-steps say the repo's remote must point at `GITEA_INSTANCE_URL`.

## Verdict

All three locked command strings from ticket 05 work verbatim, non-interactively, with the env-only auth from ticket 04 (no config file, no TTY), relying on git-remote auto-detection. Label filtering, JSON shapes, comments-in-view, comment-then-close, and exit codes (0 success / 1 any error) all confirmed against a real Forgejo 17 server. The env login hard-codes `VersionCheck: false` (research 01, section g), so no version-check flag is needed in the commands.

Raw capture: `/tmp/forgejo/capture.txt` (session-local; the Forgejo instance was torn down after the run).
