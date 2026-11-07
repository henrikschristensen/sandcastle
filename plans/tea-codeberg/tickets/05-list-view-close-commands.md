---
title: "Decide: exact LIST/VIEW/CLOSE command strings for the gitea entry"
type: grilling
state: closed
assignee: henrikschristensen
blocked_by: [01-tea-cli-capabilities, 04-host-repo-auth-wiring]
---

## Question

Lock the exact `LIST_TASKS_COMMAND` / `VIEW_TASK_COMMAND` / `CLOSE_TASK_COMMAND` strings for the `gitea` entry in `ISSUE_TRACKER_REGISTRY`, using the literal `<ID>` placeholder in view/close:

- LIST filters to open issues carrying the `Sandcastle` label (mirroring github-issues' `--label Sandcastle`) and emits JSON; decide the jq shaping so the prompt gets the same shape as the github entry's (`number, title, body, labels, comments`) — what fields does `tea issue list --output json` actually return (01), and does the view command's output include comments or does the prompt need a separate `tea comment list`?
- VIEW and CLOSE include whatever repo/auth/version-check flags 04 settled on, and CLOSE carries a `Completed by Sandcastle` comment (mirroring github-issues).
- Decide how these strings reference the repo derived from the git remote (rely on tea's auto-detection vs. explicit `--repo "$(…)"`).

## Resolution

Locked via grilling (2026-11-07), grounded in `research/tea-cli-capabilities.md` (ticket 01) and ticket 04's wiring:

```ts
templateArgs: {
  LIST_TASKS_COMMAND:
    "tea issues list --state open --labels Sandcastle --limit 100 --fields index,title,state,labels,body,url -o json",
  VIEW_TASK_COMMAND: "tea issues <ID> --comments -o json",
  CLOSE_TASK_COMMAND: `tea comments add <ID> "Completed by Sandcastle" && tea issues close <ID>`,
}
```

- `<ID>` is the issue **index** (the `index` field of list output). Commands run bare — the repo comes from tea's git-remote auto-detection locked in 04; `-r owner/repo` is the documented override. No auth or version-check flags needed: the env login from 04 disables the version check implicitly.
- LIST pipes through **no jq**: raw `-o json` works in every sandbox including native hosts without a jq binary (image Dockerfiles do install jq, but the host toolchain may not have it). All JSON values are strings (`index` needs `tonumber` if parsed; `labels` is space-separated in list mode). `--fields …,body,url` adds the body so the prompt can pick a task without a view call.
- VIEW is JSON with comments embedded — `--comments` is required for the `comments` array (research 01, section b).
- CLOSE is compound: `tea comments add` first, then `tea issues close` (close takes no comment flag; research 01, section c). This mirrors github-issues' fixed closing comment inside the single template-arg string.
- Label: keep `--labels Sandcastle` with a **single** label — tea ORs multiple labels and silently drops unknown ones, so a missing `Sandcastle` label would make list return ALL open issues. Cross-ref: ticket 07 extends `--create-label` and the prompt strip logic (currently matching gh's ` --label Sandcastle` spelling) to gitea's `--labels Sandcastle`; ticket 08 documents that users must create the label on their Gitea repo.
