---
title: "What events do vibe -p --output json and --output streaming emit?"
type: research
state: closed
assignee: henrikschristensen
blocked_by: []
---

## Question

What exactly does `vibe -p "<prompt>" --output json` emit on stdout in Vibe 3.0.4, and how does `--output streaming` differ? I need the event-by-event schema of the programmatic JSON output: assistant text deltas, tool calls (tool names plus the argument field that carries a displayable arg, e.g. bash `command`), the final result message, per-call token usage, any context-window figure, errors (and whether they go to stdout or stderr), and the session ID event.

## Sources (primary only)

- The local install's source: `vibe 3.0.4` at `/nix/store/yv9apsfc489whxasi5vjvdm42kdpgmlf-mistral-vibe-3.0.4/lib/python3.14/site-packages/vibe` — find the `-p` / output-format code paths.
- `vibe --help` and `vibe -p --help` output.
- https://docs.mistral.ai/vibe/code/overview and the README of https://github.com/mistralai/mistral-vibe.
- One real captured run if usable: `vibe -p "Reply with exactly: OK" --output json --auto-approve` (the API key is already in the env; never print it, never read `~/.vibe/.env`). Sanitize captured output before committing.

## Deliverable

Write findings to `research/vibe-p-output-schema.md` (working tree; the map owner commits on a throwaway branch): the event-by-event schema with 2–3 real sample lines per event type, each claim cited to its source, plus a suggested mapping to Sandcastle's `ParsedStreamEvent` types (`text`, `tool_call`, `result`, `usage`, `context_window`, `error`, `session_id` — see `src/AgentProvider.ts`). Then add a `## Findings` section at the bottom of this ticket file pointing at the doc, and set `state: closed`.

## Findings

Full write-up: [`research/vibe-p-output-schema.md`](../../../research/vibe-p-output-schema.md) (primary sources: vibe 3.0.4 nix-store site-packages, the `v3.0.4` tag of `mistralai/mistral-vibe` `cli-rust/`, `vibe --help`, docs.mistral.ai, plus 7 sanitized real `vibe -p` runs).

Gist: in 3.0.4 all three `--output` modes print **history entries** (`PublicHistoryEntry`: `message` / `reasoning` / `effect` / `callback` / `checkpoint` / `notice`, camelCase, each carrying `sessionId`/`turnId`/`generationStatus`). `--output streaming` = NDJSON, one whole entry per line, emitted live when `generationStatus=="completed"` (no deltas — patches are applied client-side); `--output json` = one pretty-printed JSON array of the **entire session history** (all turns on resume), printed at run end; `--output text` = last assistant text of the current turn only. Tool calls are `effect` entries (`detail.toolName` e.g. `file_system.bash`, displayable arg in `detail.input.command` for `kind=="shell"`, else `detail.display.summary`). Errors are never on stdout: stderr gets `Error: …` / `Stopped: …` with exit codes 0/1/2/3/4 (`run_export/model.rs`); in-stream failures appear as `notice` level `error` or `effect` `state.status=="failed"`. There are **no usage, context-window, or session-id events on stdout** — `session/statsUpdated` is consumed internally for budgets only; usage (`RunUsage{input_tokens, output_tokens, cached_input_tokens, total_tokens}`, `cost_usd`) and `session_id` live in `--output-dir`'s `export.json`, and `context_window` only in the app-server protocol/stats. Mapping to `ParsedStreamEvent` (streaming mode): `text` ← assistant `message` content text blocks; `tool_call` ← `effect`; `result` ← last assistant message of the current `turnId`; `session_id` ← `sessionId` of the first line; `error` ← `notice`/`failed effect` on stream plus exit-code/stderr handling; `usage` and `context_window` must come from `parseSessionUsage`/`parseSessionContextWindow` over the captured session (or `export.json`), not from the stream.
