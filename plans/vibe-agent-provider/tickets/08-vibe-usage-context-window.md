---
title: "Usage and context-window sourcing: stream events vs meta.json stats"
type: grilling
state: open
assignee: ""
blocked_by: [01-vibe-p-output-schema, 03-vibe-session-storage, 05-vibe-roundtrip-empirical]
---

## Question

Where do the usage display and the `Context window: NNNk` figure come from for vibe? Options per the adding-an-agent-provider doc: stream `usage` / `context_window` events, or session-log parsing via `parseSessionUsage` / `parseSessionContextWindow` (Claude/Codex precedent). Vibe's `meta.json` carries `stats` (`last_turn_prompt_tokens`, `context_tokens`, ...); decide:

- Does the `-p` stream emit per-call usage? If yes, map it to `usage` / `context_window` events (ADR 0023: one `context_window` per model call, last wins — never a turn/session sum).
- If not, implement `parseSessionUsage` and/or `parseSessionContextWindow` over the captured session (which file? `meta.json` stats vs `messages.jsonl` usage lines?) — and what that implies for `captureSessions` (usage display then requires capture).
- Error if neither source exists (Cursor precedent: emit nothing).

Record the decision and the exact JSON paths in `## Resolution`.
