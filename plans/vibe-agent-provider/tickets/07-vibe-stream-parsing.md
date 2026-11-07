---
title: "Stream parsing map: vibe events to ParsedStreamEvent and tool display"
type: grilling
state: closed
assignee: henrikschristensen
blocked_by: [01-vibe-p-output-schema, 05-vibe-roundtrip-empirical]
---

## Question

How does `parseVibeStreamLine` map each vibe `-p` JSON event to Sandcastle's `ParsedStreamEvent` (`src/AgentProvider.ts`)? Decide:

- Which event carries the session ID → `session_id` (required for resume).
- Assistant text deltas → `text`; final message → `result`; in-stream errors → `error` (stdout vs stderr per the research).
- Tool calls → `tool_call` with the shared `TOOL_ARG_FIELDS` allowlist (`Bash`/`WebSearch`/`WebFetch`/`Agent`/`Skill`) — vibe's tool names differ (`bash`, `read_file`, ...); decide the name normalization (pi's case-insensitive match is the precedent) and the display arg field per tool (bash → `command`?).
- `usage` and `context_window` events if the stream carries per-call figures (ADR 0023: last model call only, never summed).
- Defensive parsing rules: try/catch on JSON.parse, tolerate unknown event types, match existing style.

Consult `/grilling` + `/domain-modeling`. Record the event-by-event mapping table in `## Resolution`, plus which sample lines from ticket 01 the tests will use.

## Resolution

Locked via grilling with the user (2026-11-07). `parseVibeStreamLine` maps `--output streaming` NDJSON lines (one whole `PublicHistoryEntry` per line, camelCase) as follows:

| ParsedStreamEvent | vibe source | rule |
| --- | --- | --- |
| `session_id` | `sessionId` on any entry | emitted per line; Orchestrator last-wins (constant per run) |
| `text` + `result` | `type=="message" && role=="assistant"` | text blocks joined `"\n\n"`; both events per entry (codex precedent); skip `outcome.type=="discarded"` |
| `tool_call` | `type=="effect"` with allowlisted tool | strip `file_system.` prefix from `detail.toolName`, match case-insensitively against `TOOL_ARG_FIELDS` (pi precedent): `bash`→Bash (`kind=="shell"` → `detail.input.command`), `web_search`→WebSearch (`input.query`), `web_fetch`→WebFetch (`input.url`), `subagent`→Agent (`input.agent_name` else `display.summary`), `skill`→Skill (skill name else `display.summary`); arg fallback `detail.display.summary`; non-allowlisted effects skipped |
| `error` | `type=="notice" && level=="error"` → `message`; `type=="effect" && state.status=="failed"` → `state.error.message` | process-level stderr/exit codes stay with the Orchestrator |
| `usage`, `context_window` | never from the stream | sourced from the captured session — ticket 08 |

Robustness: try/catch `JSON.parse`; non-JSON lines and unknown entry `type`s → `[]`; missing fields tolerated; `reasoning`/`checkpoint`/`callback` entries dropped; tool_call emitted on arrival (streaming lines only ever arrive at completion, so no state gating). Test fixtures: the sanitized sample lines in `research/vibe-p-output-schema.md` §5 and `research/vibe-roundtrip/run1.out`.
