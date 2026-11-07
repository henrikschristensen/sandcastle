---
title: "Resume and fork semantics: --resume wiring, canFork"
type: grilling
state: open
assignee: ""
blocked_by: [02-vibe-cli-surface, 05-vibe-roundtrip-empirical, 09-vibe-session-storage-design]
---

## Question

How do `resumeSession` and `forkSession` in `AgentCommandOptions` map onto vibe's CLI? Decide:

- `resumeSession` → `--resume <id>` appended to the print command (verify it composes with `-p`/`--output`/`--model` per the empirical ticket).
- `forkSession` → does any `-p`-mode fork exist (ADR 0018)? If not, declare `canFork: false` on the session storage so `.fork()` throws `ForkNotSupportedError` before any sandbox starts (Cursor/Copilot precedent, ADR 0021). If yes, wire it.
- No-sandbox resume precheck behavior: `findByIdOnHost` usage when the agent runs on the host and writes sessions in place under a cwd-derived dir.
- `captureSessions: true` default + opt-out on `VibeOptions`.

Record the decision and the exact flag composition in `## Resolution`.
