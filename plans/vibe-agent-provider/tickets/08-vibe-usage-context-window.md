---
title: "Usage and context-window sourcing: stream events vs meta.json stats"
type: grilling
state: closed
assignee: henrikschristensen
blocked_by: [01-vibe-p-output-schema, 03-vibe-session-storage, 05-vibe-roundtrip-empirical]
---

## Question

Where do the usage display and the `Context window: NNNk` figure come from for vibe? Options per the adding-an-agent-provider doc: stream `usage` / `context_window` events, or session-log parsing via `parseSessionUsage` / `parseSessionContextWindow` (Claude/Codex precedent). Vibe's `meta.json` carries `stats` (`last_turn_prompt_tokens`, `context_tokens`, ...); decide:

- Does the `-p` stream emit per-call usage? If yes, map it to `usage` / `context_window` events (ADR 0023: one `context_window` per model call, last wins — never a turn/session sum).
- If not, implement `parseSessionUsage` and/or `parseSessionContextWindow` over the captured session (which file? `meta.json` stats vs `messages.jsonl` usage lines?) — and what that implies for `captureSessions` (usage display then requires capture).
- Error if neither source exists (Cursor precedent: emit nothing).

Record the decision and the exact JSON paths in `## Resolution`.

## Resolution

Locked via grilling with the user (2026-11-07):

1. **Usage source: last usage-bearing line of the session journal** (journal `*.jsonl` in the unified session dir; verified present on every run). `parseSessionUsage(content)` scans backwards for the last line with a `usage` object and maps it codex-style: `inputTokens = input_tokens − cached_input_tokens`, `cacheReadInputTokens = cached_input_tokens`, `cacheCreationInputTokens = cache_write_tokens`, `outputTokens = output_tokens` (`input_tokens` already includes the cached subset — no double counting). `meta.json` `stats.last_turn_*` NOT used (observed empty in the 3.0.4 unified store); stream and `export.json` ruled out by tickets 01/06.
2. **Context window: same last journal usage line** — `parseSessionContextWindow` returns `{ tokens: input_tokens }` (per-call input side, cache included, last call wins — ADR 0023 exactly; never summed). `limit` omitted (model `max_context_length` is null in practice; only `auto_compact_threshold` exists).
3. **Contract:** `sessionStorage.readHostSession(cwd, id)` returns the concatenated journal JSONL in sequence order (ticket 09 implements); both parsers take the LAST usage line. Both figures are capture-gated: `captureSessions: false` → no usage display, no context window, no resume (Cursor precedent). Default `captureSessions: true`.
