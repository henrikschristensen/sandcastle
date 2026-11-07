---
title: "Init scaffold: AGENT_REGISTRY entry, VIBE_DOCKERFILE, env example, host CLI"
type: grilling
state: closed
assignee: henrikschristensen
blocked_by: [04-vibe-docker-install, 06-vibe-print-command]
---

## Question

What does `sandcastle init` offer for vibe? Decide the `AGENT_REGISTRY` entry in `src/InitService.ts` (see the existing entries for claude-code/pi/codex/cursor/opencode/copilot):

- `name: "vibe"`, label, `defaultModel` (a sensible Mistral default alias — the user said follow conventions), `factoryImport: "vibe"`.
- `VIBE_DOCKERFILE` constant following `CLAUDE_CODE_DOCKERFILE`'s structure (`usermod` block, `{{ISSUE_TRACKER_TOOLS}}` placeholder, `USER agent`, `ENTRYPOINT ["sleep", "infinity"]`), install line per the docker-install research.
- `envExample`: `MISTRAL_API_KEY` (and anything else the print-command ticket's env defaults require).
- `setupCommand` and `hostCli` (`command: "vibe"`, install hint — `uv tool install mistral-vibe` or pip, per research).

Record the full entry + Dockerfile in `## Resolution`.

## Resolution

Locked via grilling with the user (2026-11-07). The `AGENT_REGISTRY` entry:

- `name: "vibe"`, `label: "Mistral Vibe"`, `defaultModel: "mistral-medium-3.5"` (vibe's documented default; a fresh-config catalog alias), `factoryImport: "vibe"`.
- `VIBE_DOCKERFILE`: identical skeleton to `CLAUDE_CODE_DOCKERFILE` (apt git/curl/jq → `{{ISSUE_TRACKER_TOOLS}}` → UID/GID usermod → `USER` → `WORKDIR /home/agent` → `ENTRYPOINT ["sleep", "infinity"]`), install line as the agent user: `curl -LsSf https://astral.sh/uv/0.11.26/install.sh | sh && uv tool install mistral-vibe` — pinned uv installer (0.11.26, what Mistral's own install.sh pins), unpinned package (image build = pin, mirroring all other templates). `vibe` lands in `/home/agent/.local/bin`, already on PATH. Rationale per ticket 04: PyPI needs Python ≥ 3.12, bookworm apt has 3.11, no npm package — uv's managed CPython is the only clean route.
- `envExample`: `# Mistral API key (env alone suffices for headless -p; no browser sign-in)\nMISTRAL_API_KEY=`.
- `setupCommand`: `vibe "$(cat .sandcastle/<setup-doc>)"` — interactive with positional initial prompt (codex pattern); NOT `-p` (headless would exit instead of setting up).
- `hostCli`: `{ command: "vibe", install: "uv tool install mistral-vibe" }`.
