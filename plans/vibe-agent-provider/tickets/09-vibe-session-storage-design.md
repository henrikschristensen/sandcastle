---
title: "Session storage design: host-sandbox capture/resume, cwd rewrite, layout helpers"
type: grilling
state: open
assignee: ""
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
