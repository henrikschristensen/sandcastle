# Codeberg.org token scopes and Gitea/Forgejo specifics

Research for [plans/tea-codeberg/tickets/03-codeberg-token-scopes.md](../plans/tea-codeberg/tickets/03-codeberg-token-scopes.md) — what the `gitea` scaffold entry needs from Codeberg.org.

**Date:** 2026-11-07

All claims below were verified against primary sources only (Codeberg's own docs/repos, the Forgejo source Codeberg runs, the tea source, the tea issue tracker). No token or account was created; no secrets were read. The user has Codeberg SSH keys on this host (`~/.ssh/id_codeberg`, not read here) — those cover git-over-SSH only; the REST API needs a token.

## 1. Platform reality check: Codeberg runs Forgejo, not Gitea

Codeberg.org is served by **Forgejo** (the community hard fork of Gitea that Codeberg e.V. maintains), currently a v17 development build. Every codeberg.org page footer fetched during this research reads `Forgejo version: 17.0.0-93-4d598f4` (e.g. the 404 page at `https://codeberg.org/forgejo/forgejo/raw/branch/forgejo/...`). Codeberg's docs state "See also the documentation of Forgejo, the software which Codeberg is based on" (https://docs.codeberg.org/advanced/), and the deployed code lives in the public repo `codeberg.org/Codeberg-Infrastructure/forgejo` ("Codeberg's fork of Forgejo … The code deployed to Codeberg").

Consequence for the scaffold: the `gitea` entry talks to a **Gitea-compatible REST API served by Forgejo**. Forgejo keeps the Gitea API surface, URL layout (`/api/v1`), token scheme, and the classic `read:`/`write:` scope names (see §4), so everything below applies to "any Gitea instance" with the caveat that Codeberg itself is Forgejo.

## 2. API base URL

- **REST API base: `https://codeberg.org/api/v1`** — confirmed. Forgejo serves the API at `<root>/api/v1`; the swagger UI is at `/api/swagger` and the raw OpenAPI v2 spec at `/swagger.v1.json` (Forgejo docs, "API": "the raw JSON file can be accessed via https://try.next.forgejo.org/swagger.v1.json. A human readable UI … via https://try.next.forgejo.org/api/swagger", https://forgejo.org/docs/latest/user/api/). On Codeberg the swagger UI is linked as `https://codeberg.org/api/swagger#/repository` from codeberg.org-hosted issues (e.g. https://codeberg.org/forgejo/forgejo/issues/4831). The API is enabled by default on Forgejo instances and is on at Codeberg.
- Auth headers accepted (Forgejo docs, "API Usage → Authentication", https://forgejo.org/docs/latest/user/api-usage/): HTTP basic, `Authorization: Bearer …`, or `Authorization: token …` (the personal access token).
- **tea's login URL for Codeberg is simply `https://codeberg.org`**: `tea login add --url/-u` takes the server URL, defaults to `https://gitea.com`, and reads env var `GITEA_SERVER_URL` (tea source `cmd/login/add.go`, https://gitea.com/gitea/tea/raw/branch/main/cmd/login/add.go). So `tea login add --name codeberg --url https://codeberg.org --token …` is the whole login.

## 3. Token creation path (web UI), confirmed on codeberg.org today

Codeberg's own documentation page "Generating an Access Token" (https://docs.codeberg.org/advanced/access-token/; source `codeberg.org/Codeberg/Documentation` `content/advanced/access-token.md`) gives the path:

1. On codeberg.org, click the profile picture ("Profiles and Settings") top right.
2. Click **Settings** (`https://codeberg.org/user/settings`).
3. Open the **Applications** tab (`https://codeberg.org/user/settings/applications`).
4. Under "Manage Access Tokens | Generate New Token", enter a `Token Name` and generate.
5. The token is shown **only once** — copy it immediately.

In the current Forgejo UI (v17, per the source Codeberg runs) the Applications page has a **"New access token"** button leading to a dedicated form at `https://codeberg.org/user/settings/applications/tokens/new`. Source: Forgejo `templates/user/settings/applications.tmpl` (button `href="{{AppSubUrl}}/user/settings/applications/tokens/new"`) and route registration in `routers/web/web.go`: `m.Group("/user/settings", … m.Group("/applications", … m.Group("/tokens", … m.Combo("/new").Get(…AccessTokenCreate).Post(…AccessTokenCreatePost)))` (https://codeberg.org/forgejo/forgejo, branch `forgejo`). tea's own help text points at the same place: `--token` usage string is "Access token. Can be obtained from Settings > Applications" (`cmd/login/add.go`).

The New-access-token form also has a **repository/organization access selector**: _All_ repositories, _Public only_, or _Specific repositories_ (Forgejo `templates/user/settings/applications.tmpl` renders `ResourceAllRepos` / `DisplayPublicOnly` / the specific-repo list; Forgejo docs: "three options … All (public, private, and limited), Public only, and Specific repositories"). A _public-only_ token is limited to public repos (issue access limited to issues in public repos). For the scaffold use "All" or pin the one repo under "Specific repositories".

## 4. Exact scope names, and the minimum set for list / view+comments / close+comment

The canonical list is in the Forgejo source Codeberg runs: `models/auth/access_token_scope.go` (https://codeberg.org/forgejo/forgejo/raw/branch/forgejo/models/auth/access_token_scope.go). The scopes are the classic Gitea-style names — there is **no** newer granular `issue:read` style on Codeberg:

- `all` (everything)
- `public-only` (public repos/orgs only)
- `read:`/`write:` pairs for each category: `activitypub`, `admin`, `misc`, `notification`, `organization`, `package`, **`issue`**, **`repository`**, `user`, `project` — e.g. `read:issue`, `write:issue`, `read:repository`, `write:repository`, `read:user`, `write:user`.

Same file: the write bit includes the read bit (`accessTokenScopeWriteIssueBits = 1<<iota | accessTokenScopeReadIssueBits`), so **`write:issue` implies `read:issue`** — selecting `write:issue` alone technically covers reads too.

Minimum for the scaffold's three operations (list open issues = `GET /repos/{o}/{r}/issues`, view one issue + comments = `GET …/issues/{i}` + `GET …/issues/{i}/comments`, close with comment = `PATCH …/issues/{i}` + `POST …/issues/{i}/comments` — all Issue-category routes):

- **`read:issue` + `write:issue`** (select both checkboxes; `write:issue` alone would suffice bit-wise).
- Nothing else is required for the issue endpoints themselves; the repository-access selector on the token decides _which_ repos the token may touch. For a private repo, prefer `read:repository` as well if repo metadata endpoints are hit, but the issue/comment routes are governed by the Issue category.

**Tokens can also be created via the API**, but only with a password, not with another token: `POST /api/v1/users/{username}/tokens` "is a special endpoint and requires you to authenticate using `BasicAuth` and a password" (Forgejo docs, https://forgejo.org/docs/latest/user/api-usage/#generating-and-listing-api-tokens), body keys are `name` and `scopes` (list of scope names, e.g. `["read:issue","write:issue"]`); with 2FA add header `X-Forgejo-OTP`. Route source: Forgejo `routers/api/v1/api.go` — `m.Group("/tokens", … m.Combo("").Get(user.ListAccessTokens).Post(bind(api.CreateAccessTokenOption{}), reqBasicOrRevProxyAuth(), reqToken(), user.CreateAccessToken) …)`. The returned `sha1` is the token and is shown/returned only once. tea can do this itself: `tea login add --user … --password … --scopes "read:issue,write:issue" --url https://codeberg.org` (flags `--user`/`--password` read env `GITEA_SERVER_USER`/`GITEA_SERVER_PASSWORD`, `--scopes` reads env `GITEA_SCOPES`, `cmd/login/add.go`).

**Expiry:** the web form's New-access-token page offers an optional expiration (do not set one for an unattended scaffold token, or set the longest); API-created tokens via `POST /users/{username}/tokens` accept only `name` + `scopes`, so they get the instance default (no expiry unless the instance enforces one). Tokens can be regenerated/deleted later on the same Applications page (`/tokens/regenerate`, `/tokens/delete`).

## 5. Labels on issues

- Gitea/Forgejo issues have labels; the API filters by label name: `GET /repos/{owner}/{repo}/issues?labels=…` — swagger comment in Forgejo `routers/api/v1/repo/issue.go` (`ListIssues`): "name: labels — Comma-separated list of label names. Fetch only issues that have any of these labels. Non existent labels are discarded." So `?labels=Sandcastle` matches issues carrying the `Sandcastle` label. (https://codeberg.org/forgejo/forgejo/raw/branch/forgejo/routers/api/v1/repo/issue.go)
- tea exposes it directly: `tea issue list --labels, -L` — "Comma-separated list of labels to match issues against." (tea `docs/CLI.md`, https://gitea.com/gitea/tea/raw/branch/main/docs/CLI.md). Known upstream bug to be aware of: tea issue **#834** "Tea ignores labels if the label can't be found" (closed) — https://gitea.com/gitea/tea/issues/834.

## 6. Codeberg-specific quirks for unattended CLI use

- **Rate limits:** Codeberg publishes **no fixed numeric per-account API quota** — it is a donation-funded non-profit and asks for fair use; abusive automated traffic is throttled/blocked at instance and CDN level. What is observable: rate limiting is **per-area** (login, browsing, search, API…) and returns HTTP **429**; the throttling windows were reworked from 30 to **10 minutes** (Codeberg changelog issue #2, https://codeberg.org/Codeberg/changelog/issues/2); search endpoints allow ~4000 searches / 30 min per IP (Codeberg/Community #2185, https://codeberg.org/Codeberg/Community/issues/2185); 429 reports in Codeberg/Community #1645 ("429: Too many requests", which also references the reverse-proxy Caddy rate-limit config in `codeberg.org/Codeberg-Infrastructure/scripted-configuration`, `hosts/_reverseproxy/.../forgejo-prod.site`). Forgejo itself ships an optional per-instance rate limiter configured by the admin (not published numerically by Codeberg). Practical guidance for the scaffold: few, batched calls; on 429, back off — do not retry in a tight loop.
- **Terms of Use restrict LLM-generated content:** Codeberg's ToS §2(1)7 — "You must not share projects that mostly consist of code written by 'generative AI'-tools …" (https://codeberg.org/Codeberg/org/raw/branch/main/TermsOfUse.md; announced in blog post "Protecting our FLOSS commons from LLMs", https://blog.codeberg.org/protecting-our-floss-commons-from-llms.html; the banner "LLM-generated content is being restricted" appears on codeberg.org pages). §2 also warns on excessive traffic/resource usage. This is about repo content, but it is the policy context for an agent writing issues/PRs on Codeberg — worth a note in the scaffold docs, not a technical blocker for the API.
- **Token hygiene:** token shown once; create one token per app (Codeberg docs tip); delete when unused.
- **Disabled/limited features:** the API and swagger are on; Codeberg restricts scraping/LLM crawlers at the proxy (Forgejo PR #6979 referenced from Codeberg/Community #1645/#7200 discussions) — again, be a polite API client.

## 7. Does tea work against Codeberg out of the box?

Yes — tea targets any Gitea-compatible server and Codeberg/Forgejo is API-compatible (same major-version API guarantee in Forgejo docs). tea's relevant surface (all from `cmd/login/add.go` and `docs/CLI.md` in https://gitea.com/gitea/tea, branch `main`):

- `tea login add --name codeberg --url https://codeberg.org --token "$GITEA_SERVER_TOKEN" --no-version-check` — `--url` env `GITEA_SERVER_URL`, `--token` env **`GITEA_SERVER_TOKEN`** (note: not `GITEA_TOKEN`), `--no-version-check/-nv` skips the server-version check (use it unattended; Forgejo's v17 dev version string is not a Gitea release tea knows). Config is persisted in `$XDG_CONFIG_HOME/tea`.
- **Env-var names matter for the scaffold:** tea natively reads `GITEA_SERVER_URL` and `GITEA_SERVER_TOKEN` (plus `GITEA_SERVER_USER`/`GITEA_SERVER_PASSWORD`/`GITEA_SERVER_OTP`/`GITEA_SCOPES` for password-based token creation). The planned `.env` var `GITEA_TOKEN` must be mapped onto `GITEA_SERVER_TOKEN` (e.g. `export GITEA_SERVER_TOKEN="$GITEA_TOKEN"` or passed via `--token "$GITEA_TOKEN"` after a one-shot `tea login add`).
- Known tea tracker items touching Codeberg/unattended use (https://gitea.com/gitea/tea/issues): **#817** "tea always asks to use codeberg.org account even though that's the default" (closed — bug report explicitly against codeberg.org), **#827** "Get confirm failed: huh: could not open a new TTY" (closed — interactive confirms need a TTY, so unattended runs must avoid prompts via flags/env), **#1149** "Support one-shot authenticated calls without persisting a login (env-provided token)" (closed), **#800** "`tea -o json` emits invalid json" (closed). No open blocker for using tea against codeberg.org.
- Upstream context: the `gitea/tea` repo is archived and points to **`gt`** (`https://gitea.com/gitea/cli`) as the new official CLI; tea continues to work and remains what this map pins (see map.md), but watch `gt` for future maintenance.

## 8. Proposed `.env.example` comment for `GITEA_TOKEN`

Exact text to propose (ticket 04 owns the final var names; note tea's native env var is `GITEA_SERVER_TOKEN`):

```dotenv
# Gitea/Forgejo API token for the issue tracker (default server: Codeberg, GITEA_SERVER_URL=https://codeberg.org).
# Create it in the web UI: profile picture (top right) -> Settings -> Applications
# -> New access token  (https://codeberg.org/user/settings/applications/tokens/new).
# Scopes: check "read:issue" and "write:issue" (write:issue includes read).
# Repository access: "All repositories", or "Specific repositories" = this repo only.
# The token is shown only once - copy it now. tea reads it from GITEA_SERVER_TOKEN;
# the scaffold maps GITEA_TOKEN onto it (see `tea login add --help`).
GITEA_TOKEN=
```

## Sources

- Codeberg docs, "Generating an Access Token": https://docs.codeberg.org/advanced/access-token/ (source: `codeberg.org/Codeberg/Documentation` `content/advanced/access-token.md`); "Clone & Commit via CLI" linking the token page: `content/git/clone-commit-via-cli.md`.
- Forgejo source (Codeberg's running software, branch `forgejo`, v17.0.0-93-4d598f4 per codeberg.org page footers):
  - `models/auth/access_token_scope.go` — scope names, write-implies-read bitmap — https://codeberg.org/forgejo/forgejo/raw/branch/forgejo/models/auth/access_token_scope.go
  - `templates/user/settings/applications.tmpl` — Applications page + "New access token" button — https://codeberg.org/forgejo/forgejo/raw/branch/forgejo/templates/user/settings/applications.tmpl
  - `routers/web/web.go` — `/user/settings/applications/tokens/new` route — https://codeberg.org/forgejo/forgejo/raw/branch/forgejo/routers/web/web.go
  - `routers/api/v1/api.go` — `POST /users/{username}/tokens` requires `reqBasicOrRevProxyAuth()` — https://codeberg.org/forgejo/forgejo/raw/branch/forgejo/routers/api/v1/api.go
  - `routers/api/v1/repo/issue.go` — `labels` query param semantics on issue list — https://codeberg.org/forgejo/forgejo/raw/branch/forgejo/routers/api/v1/repo/issue.go
- Forgejo docs: API page (base `/api/v1`, swagger `/api/swagger`, spec `/swagger.v1.json`): https://forgejo.org/docs/latest/user/api/ ; API Usage (auth headers, `POST /users/:name/tokens` needs basic auth + password, body `name`+`scopes`, token returned once): https://forgejo.org/docs/latest/user/api-usage/ ; token repo-access options (All / Public only / Specific repositories): https://forgejo.org/docs/latest/user/api-usage/.
- Codeberg swagger on the live instance: https://codeberg.org/api/swagger (linked from codeberg.org/forgejo/forgejo#4831).
- Codeberg ToS: https://codeberg.org/Codeberg/org/raw/branch/main/TermsOfUse.md (§2(1)7 generative-AI rule, §2 traffic) ; blog: https://blog.codeberg.org/protecting-our-floss-commons-from-llms.html.
- Codeberg rate-limit evidence: https://codeberg.org/Codeberg/Community/issues/1645 (429s, per-area limiting, Caddy config in `Codeberg-Infrastructure/scripted-configuration`), https://codeberg.org/Codeberg/changelog/issues/2 (windows 30→10 min), https://codeberg.org/Codeberg/Community/issues/2185 (search: 4000/30 min/IP).
- tea source: `cmd/login/add.go` (flags `--url`/env `GITEA_SERVER_URL`, `--token`/env `GITEA_SERVER_TOKEN`, `--user`/`--password`/`--otp`/`--scopes` envs, `--no-version-check`) and `docs/CLI.md` (`issue list --labels/-L`) — https://gitea.com/gitea/tea/raw/branch/main/cmd/login/add.go , https://gitea.com/gitea/tea/raw/branch/main/docs/CLI.md ; tracker issues #817, #827, #834, #800, #1149 — https://gitea.com/gitea/tea/issues/817 etc.; archived notice pointing to `gt` at https://gitea.com/gitea/cli.
