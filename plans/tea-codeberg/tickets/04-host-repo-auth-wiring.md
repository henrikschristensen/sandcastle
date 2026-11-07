---
title: "Decide: host, repo and auth wiring (.env.example vars + git-remote shell expression)"
type: grilling
state: open
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
