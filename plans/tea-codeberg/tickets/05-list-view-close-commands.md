---
title: "Decide: exact LIST/VIEW/CLOSE command strings for the gitea entry"
type: grilling
state: open
assignee: henrikschristensen
blocked_by: [01-tea-cli-capabilities, 04-host-repo-auth-wiring]
---

## Question

Lock the exact `LIST_TASKS_COMMAND` / `VIEW_TASK_COMMAND` / `CLOSE_TASK_COMMAND` strings for the `gitea` entry in `ISSUE_TRACKER_REGISTRY`, using the literal `<ID>` placeholder in view/close:

- LIST filters to open issues carrying the `Sandcastle` label (mirroring github-issues' `--label Sandcastle`) and emits JSON; decide the jq shaping so the prompt gets the same shape as the github entry's (`number, title, body, labels, comments`) — what fields does `tea issue list --output json` actually return (01), and does the view command's output include comments or does the prompt need a separate `tea comment list`?
- VIEW and CLOSE include whatever repo/auth/version-check flags 04 settled on, and CLOSE carries a `Completed by Sandcastle` comment (mirroring github-issues).
- Decide how these strings reference the repo derived from the git remote (rely on tea's auto-detection vs. explicit `--repo "$(…)"`).
