---
title: "Init scaffold: AGENT_REGISTRY entry, VIBE_DOCKERFILE, env example, host CLI"
type: grilling
state: open
assignee: ""
blocked_by: [04-vibe-docker-install, 06-vibe-print-command]
---

## Question

What does `sandcastle init` offer for vibe? Decide the `AGENT_REGISTRY` entry in `src/InitService.ts` (see the existing entries for claude-code/pi/codex/cursor/opencode/copilot):

- `name: "vibe"`, label, `defaultModel` (a sensible Mistral default alias — the user said follow conventions), `factoryImport: "vibe"`.
- `VIBE_DOCKERFILE` constant following `CLAUDE_CODE_DOCKERFILE`'s structure (`usermod` block, `{{ISSUE_TRACKER_TOOLS}}` placeholder, `USER agent`, `ENTRYPOINT ["sleep", "infinity"]`), install line per the docker-install research.
- `envExample`: `MISTRAL_API_KEY` (and anything else the print-command ticket's env defaults require).
- `setupCommand` and `hostCli` (`command: "vibe"`, install hint — `uv tool install mistral-vibe` or pip, per research).

Record the full entry + Dockerfile in `## Resolution`.
