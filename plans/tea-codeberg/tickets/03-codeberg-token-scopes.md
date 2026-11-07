---
title: "Research: Codeberg.org token creation, scopes, and Gitea specifics the scaffold depends on"
type: research
state: open
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
