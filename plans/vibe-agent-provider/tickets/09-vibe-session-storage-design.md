---
title: "Session storage design: host-sandbox capture/resume, cwd rewrite, layout helpers"
type: grilling
state: closed
assignee: henrikschristensen
blocked_by: [03-vibe-session-storage, 05-vibe-roundtrip-empirical]
---

## Question

How does the `sessionStorage` sub-object for vibe implement `AgentSessionStorage` (`src/AgentProvider.ts`, ADR 0012)? Decide, from the storage research + empirical round-trip:

- Sandbox path of a session: `$VIBE_HOME/logs/session/<dir>/` — is `VIBE_HOME` fixed to the sandbox user's home, and is the dir name derivable from the session id (short id in dir name vs full UUID in `meta.json`)? A lookup glob may be needed (Codex `locateSandboxSessionFile` precedent).
- Host store layout: mirror under a sandcastle-owned host dir, or vibe's own `~/.vibe/logs/session` on the host (Claude precedent)? Keyed by cwd or by id alone (Copilot precedent)?
- cwd rewrite: `meta.json.environment.working_directory` and any cwd inside `messages.jsonl` must be rewritten sandbox-cwd ↔ host-cwd on transfer (write a `transferVibeSession` pure string function in `src/SessionStore.ts`, mirroring `transferClaudeSession`/`transferCodexSession`).
- Which files move: just `messages.jsonl` + `meta.json`, or also `attachments/`, `child-*` subagent transcripts (map fog)?
- `hostSessionFilePath`, `existsOnHost`, `readHostSession`, `findByIdOnHost` semantics — can they reuse `makeSessionFileStorage` or need a custom impl (id not derivable from path)?
- `sessionStorage` option overrides on `VibeOptions` (host/sandbox dirs), matching other providers.

Consult `/grilling` + `/domain-modeling`. Record the full design in `## Resolution`.

## Resolution

Locked via grilling with the user (2026-11-07):

1. **Host store:** mirror vibe's own host layout — `<hostRoot>/<id>/` where hostRoot defaults to `~/.vibe/logs/session/unified` (overridable via `VibeOptions.sessionStorage.hostSessionsDir`). Dir name == full session UUID, so paths are id-derivable, cwd ignored (Copilot-style). Bonus: the user can `vibe --resume <id>` captured sessions on the host directly.
2. **Capture scope:** the WHOLE main session dir `unified/<id>/` moves verbatim (journal references content-addressed chunks — partial copies corrupt resume). Child subagent dirs (`child-<hex>` siblings) are NOT captured (graduated out of fog; can be added later like claude's best-effort subagent capture).
3. **cwd rewrite:** only `meta.json` is rewritten — `environment.working_directory` and `origin_directory`, sandbox-cwd ↔ host-cwd, via a new pure string fn `transferVibeMetaJson(json, fromCwd, toCwd)` in SessionStore.ts (mirrors `transferClaudeSession`). Journal/chunks/generations/CURRENT copy byte-for-byte. On resume the reverse rewrite makes the session re-root into the sandbox cwd (ticket 05: resume re-roots to the recorded working_directory).
4. **Mechanics & method semantics:** custom dir-based `AgentSessionStorage` (like `makeClaudeSessionStorage`, NOT file-based `makeSessionFileStorage`). The handle has only single-file copy + exec, so a dir moves by `exec("find <dir> -type f")` + `copyFileOut` per file (capture), and `copyFileIn` + `mkdir -p` per file (resume). Sandbox side default: `<sandboxHome>/.vibe/logs/session/unified/<id>/` (overridable via `sandboxSessionsDir`). `hostSessionFilePath` → `<hostRoot>/<id>` (the dir); `existsOnHost` → dir exists; `readHostSession` → concatenated `journal/*.jsonl` in sequence order (ticket 08 contract); `findByIdOnHost` → `<root>/<id>` dir match first, then scan subdirs' `meta.json` `session_id` fallback.
