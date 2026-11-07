---
title: "Resume and fork semantics: --resume wiring, canFork"
type: grilling
state: closed
assignee: henrikschristensen
blocked_by: [02-vibe-cli-surface, 05-vibe-roundtrip-empirical, 09-vibe-session-storage-design]
---

## Question

How do `resumeSession` and `forkSession` in `AgentCommandOptions` map onto vibe's CLI? Decide:

- `resumeSession` → `--resume <id>` appended to the print command (verify it composes with `-p`/`--output`/`--model` per the empirical ticket).
- `forkSession` → does any `-p`-mode fork exist (ADR 0018)? If not, declare `canFork: false` on the session storage so `.fork()` throws `ForkNotSupportedError` before any sandbox starts (Cursor/Copilot precedent, ADR 0021). If yes, wire it.
- No-sandbox resume precheck behavior: `findByIdOnHost` usage when the agent runs on the host and writes sessions in place under a cwd-derived dir.
- `captureSessions: true` default + opt-out on `VibeOptions`.

Record the decision and the exact flag composition in `## Resolution`.

## Resolution

Locked via grilling with the user (2026-11-07):

1. **Fork: not supported.** `sessionStorage.canFork = false` + `buildPrintCommand` throws `ForkNotSupportedError` when `resumeSession` + `forkSession` are both set (cursor/copilot pattern, ADR 0021; no `-p`-mode fork exists — verified in ticket 05). `.fork()` fails before any sandbox starts; `resume()` continues in place.
2. **No-sandbox precheck: no vibe-specific changes.** The existing `resumePrecheck` works unchanged — `findByIdOnHost` (sandbox `none`: host in-place sessions) and `existsOnHost`/`hostSessionFilePath` (sandboxed runs) are both id-derivable for vibe per ticket 09; not-found errors name the searched root / session dir.
3. **End-to-end resume flow:** precheck → `resumeIntoSandbox` copies host `<root>/<id>/` into sandbox `$VIBE_HOME/logs/session/unified/<id>/` with meta.json cwd rewrite host→sandbox → command appends `--resume <id>` (ticket 06) → vibe re-roots into the recorded working_directory (= sandbox cwd) → `captureToHost` copies the updated dir back with sandbox→host rewrite. `captureSessions: false` (opt-out, default true) disables capture and resume.
