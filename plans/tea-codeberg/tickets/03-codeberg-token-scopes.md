---
title: "Research: Codeberg.org token creation, scopes, and Gitea specifics the scaffold depends on"
type: research
state: closed
assignee: henrikschristensen
blocked_by: []
---

## Question

What does a Codeberg.org user need for the `gitea` scaffold entry, exactly?

- Token creation path and UI: Settings → Applications → Generate New Token — confirm the path on codeberg.org today, and the exact **scope names** Gitea/Codeberg offers (e.g. `read:issue` / `write:issue`, or the newer granular `issue` scope), and the **minimum scope set** for list open issues + view one issue with comments + close one issue with a comment.
- API base URL: `https://codeberg.org/api/v1` — confirm, and whether tea's login URL for Codeberg is simply `https://codeberg.org`.
- Labels on Codeberg issues: supported (yes, Gitea issues have labels), and whether `tea issue list --labels Sandcastle` matches issues carrying that label.
- Codeberg-specific quirks relevant to unattended CLI use: rate limits on the API, any disabled features, whether tokens can be created via API, token expiry options.
- Does `tea` work against Codeberg out of the box (any known issues in the tea tracker about codeberg.org)?

## Sources (primary only)

- https://docs.codeberg.org/ (Codeberg docs), https://codeberg.org/api/swagger (API spec).
- Gitea API docs: https://docs.gitea.com/development/api-usage and the `swagger.v1.json` in the gitea source.
- tea issue tracker: https://gitea.com/gitea/tea/issues (search "codeberg").
- Do NOT create any real token; document the path only. The user has Codeberg SSH keys on this host (`~/.ssh/id_codeberg`) — note that as context but do not read or print key material.

## Deliverable

Write findings to `research/codeberg-token-scopes.md` (working tree; the map owner commits on `research/tea-codeberg`): the exact `.env.example` comment text to propose for `GITEA_TOKEN` (where to create it, which scopes), the API base URL, label support, and any quirks — every claim cited. Then add a `## Findings` section at the bottom of this ticket file and set `state: closed`.

## Findings

Full cited findings: [research/codeberg-token-scopes.md](../../../research/codeberg-token-scopes.md). Key facts:

- **Codeberg runs Forgejo, not Gitea** (page footers: `Forgejo version: 17.0.0-93-4d598f4`); the Gitea-compatible API is unchanged, so the generic `gitea` entry is correct.
- **API base URL:** `https://codeberg.org/api/v1`; swagger UI `https://codeberg.org/api/swagger`; spec `/swagger.v1.json`. Auth: `Authorization: token <sha1>`, Bearer, or basic.
- **Token path (confirmed):** profile picture (top right) → Settings → Applications (`/user/settings/applications`) → "New access token" (`/user/settings/applications/tokens/new`); token shown once; repo-access selector All / Public only / Specific repositories. Codeberg docs page: https://docs.codeberg.org/advanced/access-token/.
- **Exact scope names** (Forgejo `models/auth/access_token_scope.go`): `all`, `public-only`, and `read:`/`write:` pairs for activitypub, admin, misc, notification, organization, package, **issue**, **repository**, user, project. **Minimum for list + view-with-comments + close-with-comment: `read:issue` + `write:issue`** (`write:issue` implies `read:issue` bit-wise). Tokens can be created via API only with basic auth + password (`POST /api/v1/users/{username}/tokens`, body `name`+`scopes`); a token cannot create another token.
- **tea's login URL for Codeberg is simply `https://codeberg.org`** (`tea login add --url …`); tea reads env **`GITEA_SERVER_TOKEN`** (not `GITEA_TOKEN`) and `GITEA_SERVER_URL`, plus `--no-version-check` for unattended runs — the scaffold's `GITEA_TOKEN` must be mapped onto `GITEA_SERVER_TOKEN` (exact proposed `.env.example` comment is in §8 of the research doc).
- **Labels:** supported; `GET /repos/{o}/{r}/issues?labels=Sandcastle` filters by label name ("any of these labels; non-existent labels are discarded"), and `tea issue list --labels/-L Sandcastle` maps to it. Known tea bug #834 (ignores labels that can't be found).
- **Quirks:** no published numeric API quota — fair use, per-area rate limiting with HTTP 429 (windows reworked 30→10 min, Codeberg/changelog#2; search 4000/30 min/IP, Community#2185); Codeberg ToS §2(1)7 restricts mostly-generative-AI projects (blog "Protecting our FLOSS commons from LLMs"); token shown only once.
- **tea vs Codeberg:** works out of the box (Forgejo = Gitea-compatible API); tracker items #817 (codeberg.org default-account prompt), #827 (confirm needs a TTY — avoid prompts unattended), #1149 (env-provided token), #800 (`-o json` bug) — all closed, no open blocker. Note: upstream `gitea/tea` is archived in favor of `gt` (gitea.com/gitea/cli).
