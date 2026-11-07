---
"@ai-hero/sandcastle": minor
---

Add a `gitea` issue tracker to `sandcastle init` (`--issue-tracker gitea`): Codeberg or any self-hosted Gitea/Forgejo instance, driven by the official `tea` CLI. The scaffold lists `Sandcastle`-labeled open issues as JSON (`tea issues list … -o json`), views one with its comments (`tea issues <ID> --comments -o json`), and closes with a `Completed by Sandcastle` comment. Auth is env-only (`GITEA_INSTANCE_URL`, default `https://codeberg.org`, plus `GITEA_TOKEN` in `.env.example`), the repo is resolved from the sandbox's git remote, and the sandbox image installs a pinned, checksum-verified `tea` 0.16.0 static binary.
