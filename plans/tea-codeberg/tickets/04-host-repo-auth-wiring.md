---
title: "Decide: host, repo and auth wiring (.env.example vars + git-repo resolution)"
type: grilling
state: closed
assignee: henrikschristensen
blocked_by: [01-tea-cli-capabilities, 03-codeberg-token-scopes]
---

## Question

Lock the host/repo/auth wiring for the `gitea` entry, given the charted constraint "env vars + git-remote shell expression, no new init questions":

- Exact env var names and defaults in `envExample`: `GITEA_SERVER_URL=https://codeberg.org` and `GITEA_TOKEN=` (confirm names against tea's own env vars from 01; add `GITEA_REPO=` override only if cheap).
- The prompt shell expression that derives `owner/repo` from the sandbox's `git remote get-url origin`, handling https (`https://host/owner/repo(.git)`), ssh (`git@host:owner/repo(.git)`), ssh:// URLs, ports and `.git` suffixes — where does this expression live in the scaffolded prompts (a built-in prompt argument? inline `` !`…` `` shell expression?), and what happens when the remote is on a different host than `GITEA_SERVER_URL` (error vs. derive host from the remote instead)?
- How tea authenticates non-interactively in a fresh sandbox: env-only (if 01 says tea reads a token env var directly) vs. a one-shot `tea login add --name … --url "$GITEA_SERVER_URL" --token "$GITEA_TOKEN"` baked into a sandbox hook or the prompt's setup step. Decide one, with the failure mode when the token is missing.
- The version-check disable (from 01) — baked into every command, a config file, or an env var?
- Does init need a native-sandbox env note like the `github-issues` one in `envNotes` ("native sandbox hides your host's gh login, so authenticate from env")? tea's login config lives in `$XDG_CONFIG_HOME/tea` on the host — decide the exact note text if yes.

## Resolution

Locked via grilling with the user (2026-11-07), grounded in `research/tea-cli-capabilities.md` (01) and `research/codeberg-token-scopes.md` (03):

- **envExample ships tea's runtime env login only** — no `tea login add` anywhere:

  ```
  # Gitea/Forgejo instance + API token — the agent uses them to read and manage issues
  # Default is Codeberg. Create a token: profile → Settings → Applications → New access token (scopes: read:issue + write:issue)
  GITEA_INSTANCE_URL=https://codeberg.org
  GITEA_TOKEN=
  ```

  The env login is in-memory, needs no TTY/config file, and hard-codes `VersionCheck: false` (research 01, sections d and g). The `GITEA_SERVER_*` names are deliberately not documented — they only feed `tea login add`'s flags.
- **Repo resolution: tea's native auto-detection.** Commands run bare and tea derives owner/repo from the sandbox repo's git remote (main/master/trunk's remote, else `upstream`, else `origin`; https/scp-style/ssh URLs, subpaths and ports all parsed), matched against `GITEA_INSTANCE_URL`. No shell expression in the command strings — the charted "git-remote shell expression" is satisfied natively. `-r owner/repo` is the documented manual override (research 01, section e).
- **Host mismatch: `GITEA_INSTANCE_URL` is authoritative.** The scaffold documents that the repo's git remote must point at that instance; otherwise tea finds no matching login, list degrades to a global issue search, and view/close fail with "remote repository required" (research 01, section e).
- **Native-provider note: yes, mirror github-issues.** `envNotes` gains a gitea line on non-image providers: "<provider>() hides your host's tea login from the agent, so put GITEA_TOKEN in .sandcastle/.env for tea to use." (mention `GITEA_INSTANCE_URL` when it differs from the codeberg.org default). `.sandcastle/.env` is passed into native sandboxes, so env-only auth works there.
