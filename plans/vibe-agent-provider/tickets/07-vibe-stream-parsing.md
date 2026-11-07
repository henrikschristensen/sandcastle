---
title: "Stream parsing map: vibe events to ParsedStreamEvent and tool display"
type: grilling
state: open
assignee: ""
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
