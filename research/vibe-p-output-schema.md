# `vibe -p` output schema in Vibe 3.0.4: what `--output text|json|streaming` actually emit

Research for ticket `plans/vibe-agent-provider/tickets/01-vibe-p-output-schema.md` (wayfinder map: `plans/vibe-agent-provider/map.md`).

**Date:** 2026-11-07. **Vibe version tested:** 3.0.4 (nix store install, readable as source; cited below as `vibe-src`; Rust CLI source from the matching GitHub tag, cited as `rust-src`).

## Sources (primary only)

- `vibe-src` = `/nix/store/yv9apsfc489whxasi5vjvdm42kdpgmlf-mistral-vibe-3.0.4/lib/python3.14/site-packages/vibe/...`, cited as `vibe-src/<path>:<line>`
- `rust-src` = `github.com/mistralai/mistral-vibe` @ tag `v3.0.4` (SHA `338ad4bf`), paths under `vibe/cli-rust/src/...`, cited as `rust-src/<path>` — the wheel ships only the compiled `vibe-rs` binary (`vibe-src/_bin/vibe-rs`), so the Rust source of the headless output path is cited from this tag
- `vibe --help` / `vibe -p --help` of vibe 3.0.4 on this host (`vibe --version` → `vibe 3.0.4`); both print the same flag set
- [docs.mistral.ai — "Work with the CLI", Programmatic mode](https://docs.mistral.ai/vibe/code/cli/work-with-cli) (`--output text|json|streaming` semantics, `--output-dir` export, exit-code table)
- [mistralai/mistral-vibe GitHub README](https://github.com/mistralai/mistral-vibe#readme)
- [PyPI `mistral-vibe`](https://pypi.org/project/mistral-vibe/)
- Empirical `vibe -p` runs on this host (appendix; run with `MISTRAL_API_KEY` already in the environment; `~/.vibe/.env` and the key were never read or printed; captured stdout/stderr were scrubbed for the key value before any sample was copied here — zero occurrences found)

## Headline

In 3.0.4, `vibe -p` (headless mode) supports exactly three CLI-selectable output formats — `text` (default), `json`, `streaming` — plus a hidden `Silent` (`rust-src/cli.rs`, `enum OutputFormat`: `Text` default, `Json`, `Streaming`, `#[value(skip)] Silent`). All three write **history entries** to stdout, not a bespoke event protocol:

- **`--output streaming`** = NDJSON: **one JSON object per line, each a full history entry, emitted live as the entry completes** (`generationStatus == "completed"`). No text deltas: the client applies `history/entryUpdated` JSON patches locally and only prints the entry once complete (`rust-src/headless_output.rs`, `consume_entry`/`add_entry`/`update_entry`/`emit_entry`; `rust-src/headless/turn.rs`, `run_turn_loop` handles `history/entryAdded`/`history/entryUpdated` and calls `output.emit_entry`). Empirically: 4 lines for a 1-turn run with one tool call (appendix run 3).
- **`--output json`** = **one pretty-printed JSON array of the session's ENTIRE history, printed once at the end of the run** (`rust-src/headless_output.rs` `finalize`: `OutputFormat::Json if history.is_array() => serde_json::to_string_pretty(&history)`). The history is re-read from the app server at turn end via paginated `session/history/list` (pages of 500, newest-first, reversed; capped at 10,000 entries) — `rust-src/headless_history.rs`. On a resumed session this includes **all previous turns'** entries, not just the current run's (empirically: 9 entries across 3 turns, appendix run 7). The docs say the same: "`json` prints the session messages as a JSON array when the run ends" [docs.mistral.ai work-with-cli].
- **`--output text`** = only the **last assistant message's text of the current turn**, one line (`rust-src/headless_output.rs` `finalize` → `last_assistant_text(&turn_entries(&history, turn_id))`; `turn_entries` filters entries by `turnId`). Empirically printed exactly `OK` (appendix run 4).

**Nothing else is ever written to stdout**: no usage, no context-window figure, no session-id line, no stop-reason line. Errors go to **stderr** as `Error: <message>` (or `Stopped: <outcome>` for non-error non-finished runs) with a meaningful exit code (`rust-src/headless.rs`: `eprintln!("Error: {}", error.message)` … `headless.finish(report).into()`; `rust-src/run_export/model.rs` `RunOutcome::exit_code`). Per-entry `sessionId` is present on every entry; token usage and `context_window` exist only in the app-server `session/statsUpdated` notification (consumed internally for `--max-tokens`/`--max-price` budgets, never printed — `rust-src/headless/turn.rs`) and in the `--output-dir` `export.json` (`rust-src/headless/report.rs` builds `RunReport{result: RunResult{outcome, stop_reason, error, session_id, usage: RunUsage{input_tokens, output_tokens, cached_input_tokens, total_tokens}, cost_usd, steps, …}}}`).

## 1. CLI surface for headless mode (`vibe --help`)

`vibe --help` (3.0.4, this host): `-p, --prompt [<PROMPT>]` — "Run in headless (programmatic) mode: send prompt, output response, exit"; `--output <OUTPUT>` — "Output format for headless mode [default: text] [possible values: text, json, streaming]"; plus `--max-turns`, `--max-price`, `--max-tokens`, `--time-limit` ("…write the export and exit 3"), `--prompt-file`, `--system-prompt-file`, `--output-dir` ("On every exit, write export.json (Vibe version, effective config, token usage, cost, stop reason, outcome) and a copy of the session journal (session/) to DIR"), `--agent`, `--model`, `--auto-approve` (alias `--yolo`), `--smart-approve`, `--enabled-tools`, `--disabled-tools`, `--trust`, `--worktree`, `--add-dir`, `-c/--continue`, `--resume [<SESSION_ID>]`. Docs confirm the same list and add that in programmatic mode nobody can answer an approval prompt, so unapproved tool calls are denied unless `--auto-approve` [docs.mistral.ai work-with-cli].

Architecture: the `vibe` console script only execs the bundled Rust binary `vibe-rs`, which spawns/talks to the Python `vibe-app-server` (`vibe-src/cli/launcher.py:13-40,68-79`). Headless output is decided entirely client-side in `vibe-rs` (`rust-src/headless.rs`, `rust-src/headless_output.rs`); the app server supplies the entry models (`vibe-src/app_server/models.py`).

## 2. The entry schema (what one stdout line / array element is)

Every stdout object in `json`/`streaming` is a **`PublicHistoryEntry`**, serialized by alias in camelCase (`vibe-src/app_server/models.py:1107-1115` union, discriminator `type`):

```
PublicHistoryEntry = message | reasoning | effect | callback | checkpoint | notice
```

Common base (`vibe-src/app_server/models.py:963-970`, `_PublicHistoryEntryBase`), all present on every entry (camelCase on the wire):

```
{ "id": string, "sessionId": string, "turnId": string|null, "inputEntryId": string|null,
  "createdAt": int(ms), "updatedAt": int(ms), "generationStatus": "pending"|"streaming"|"completed"|…,
  "relatedEntryId": string|null, "type": … }
```

(`PublicEntryGenerationStatus`, `vibe-src/app_server/models.py:365`.) `generationStatus == "completed"` is exactly the streaming-emit condition (`rust-src/headless_output.rs` `is_completed`).

| `type` | extra fields | source |
| --- | --- | --- |
| `message` | `role: "system"|"user"|"assistant"`, `content: ContentBlock[]` (`text`/`image`/`resource` blocks, `models.py:200-217`), `source: "turn_start"|"turn_steer"|"harness"|null`, `userDisplayContent`, `outcome: {type:"committed"} | {type:"discarded", cause:string} | null` | `models.py:992-1013` |
| `reasoning` | `text: string`, `summary: string[]`, `outcome` | `models.py:1015-1020` |
| `effect` | `title: string`, `detail: EffectDetail`, `state: EffectState` | `models.py:1022-1027` |
| `callback` | `callbackId`, `title`, `detail`, `state: {status: open\|answered\|cancelled\|expired, …}` | `models.py:1029-1036, 928-958` |
| `checkpoint` | `kind: string`, `message: string|null`, `details: any` | `models.py:1093-1098` |
| `notice` | `level: "info"|"warning"|"error"`, `message: string`, `detail: {kind: hook_*\|agent_changed\|session_title_updated\|waiting_for_input\|scheduled_loop_fired, …}` | `models.py:1100-1106, 1038-1091` |

Assistant text = `content[]` blocks of `type:"text"` joined with `"\n\n"` (mirrors `PublicMessageEntry.text`, `models.py:1000-1003`, and `rust-src/headless_output.rs` `last_assistant_text`).

**Tool calls are `effect` entries.** `detail` is discriminated by `kind` (`vibe-src/app_server/_effect_models.py:233-360`, `EffectDetail` union at `:349-362`); every variant has `toolName`, `display` (`EffectCallDisplay`: `summary`, `verb`, `message`, `settledVerb`, `settledMessage`, `statusText`, …) and a kind-specific `input`. Kinds: `tool` (generic, `input: any`), `shell` (`input.command` — the bash arg), `file_edit` (`input.file_path`, `old_string`, `new_string` or `changes[]`), `file_search` (`input.pattern`, `path`), `file_read` (`input.file_path`, `offset`, `limit`), `todo`, `file_write` (`input.file_path`, …), `user_question`, `web_search` (`input.query`), `web_fetch` (`input.url`), `skill`, `subagent` (adds `child_session_id`, `agent_name`), `worktree`, `process`, `scratchpad`. `state` is discriminated by `status` (`vibe-src/app_server/models.py:862-920`): `pending`, `running` (`outputText`), `blocked`, `completed` (`output`, `outputText`, `durationMs`, `display.success`, `decision`, `approvalType`, `approvalSource`), `failed` (`error: PublicError`), `cancelled`, `skipped`.

Note on tool names in 3.0.4: the unified harness exposes builtins with a `file_system.` prefix — `file_system.bash`, `file_system.read_file`, `file_system.write_file`, `file_system.edit` — with a mapping back to short names (`vibe-src/app_server/_unified_harness_backend_adapter.py:12635-12638`; observed `title`/`detail.toolName` = `file_system.bash`). So `effect.title == detail.toolName`, e.g. `"file_system.bash"`.

## 3. Format semantics, precisely (`rust-src/headless_output.rs`, `rust-src/headless/turn.rs`, `rust-src/headless_history.rs`)

- Only `Streaming` consumes notifications live. `consume_entry` returns an entry only when `generationStatus=="completed"`; incomplete entries are held in `pending` (cap 512, `MAX_TRACKED_ENTRIES`) and patched via `history/entryUpdated`'s `patch` (JSON Patch) until completed, then emitted **once** as a single compact JSON line (`emit_entry` → `writeln!(stdout, line)`). So streaming lines are whole entries, in completion order, one per id — never deltas.
- `json`/`text` ignore notifications; at `turn/completed` (matched on `turn.id`) the client re-reads the **full** history (`session/history/list`, pages ≤500, newest-first reversed, bail on empty-page-with-cursor / repeated cursor, cap `MAX_HISTORY_ENTRIES = 10_000`) and `finalize` writes: `json` → the whole array pretty-printed (all turns of the session); `text` → `last_assistant_text` over entries filtered to the current `turnId`, skipping assistant messages whose `outcome` is `{type:"discarded", cause:"retry"}` and empty texts. `streaming` writes nothing at finalize.
- The turn loop also consumes `session/statsUpdated` (usage → budget checks only, **not printed**), `agent_socket/aborted`, `turn/completed` (status `failed` → run fails with the turn's `error.code`/`error.message`, `vibe-src/app_server/models.py:1273-1286` `PublicTurn{status, error, stop_reason}`), `server/disconnected`, `callback/result failed` (`rust-src/headless/turn.rs` `run_turn_loop`).
- After the turn, the client waits for subagents, stops the session, and builds the export report (`rust-src/headless/report.rs`); `--output-dir DIR` writes `export.json` + a `session/` journal copy on every exit (`vibe --help`; `rust-src/run_export.rs`: `EXPORT_FILENAME = "export.json"`).

## 4. Errors, stderr, exit codes

- Run-level errors: `eprintln!("Error: {message}")` on **stderr**, nothing on stdout; non-error non-finished outcomes print `Stopped: {outcome}` (`rust-src/headless.rs`). Empirically: `vibe -p "Reply with exactly: OK" --output streaming --auto-approve --model nonexistent-model-xyz` → exit **1**, stdout empty, stderr `Error: Unknown model: nonexistent-model-xyz. Available: …` (appendix run 5).
- Exit codes (`rust-src/run_export/model.rs` `RunOutcome::exit_code`; docs table [work-with-cli] lists 0–3): `0` Finished; `1` UsageError/ConfigError; `2` InfrastructureFailure (model API / runtime); `3` TurnLimit/TokenLimit/PriceLimit/Deadline/Terminated/Length/Refusal ("stopped before finishing"); `4` Aborted. `--time-limit` explicitly exits 3 (`vibe --help`).
- In-stream failures surface **on stdout as entries**: `effect` with `state.status=="failed"` and `state.error`, and `notice` with `level=="error"` (`models.py:888-895, 1100-1104`); a failed turn makes the whole run exit non-zero with the error on stderr.

## 5. Sanitized real captures (appendix runs; key-scrubbed)

`--output streaming`, `vibe -p "Use your bash tool to run exactly: echo stream-demo-456 ; then reply with exactly DONE" --output streaming --auto-approve` → exit 0, stderr only a config-warning line, stdout exactly these 4 NDJSON lines (one per completed entry; sessionId constant across lines):

```json
{"id":"user-turn-5897fc80fd36998c864932980727f83c-1","sessionId":"5154f63d-170d-c603-39eb-2c93d344bcbb","turnId":"turn-5897fc80fd36998c864932980727f83c","inputEntryId":null,"createdAt":1794048314606,"updatedAt":1794048314606,"generationStatus":"completed","relatedEntryId":null,"type":"message","role":"user","content":[{"type":"text","text":"Use your bash tool to run exactly: echo stream-demo-456 ; then reply with exactly DONE"}],"source":"turn_start","userDisplayContent":null,"outcome":null}
{"id":"reasoning-730865ee-3161-540d-bba0-f4e2eacc6222-0","sessionId":"5154f63d-170d-c603-39eb-2c93d344bcbb","turnId":"turn-5897fc80fd36998c864932980727f83c","inputEntryId":"user-turn-5897fc80fd36998c864932980727f83c-1","createdAt":1794048315890,"updatedAt":1794048315890,"generationStatus":"completed","relatedEntryId":null,"type":"reasoning","text":"The user wants me to run exactly `echo stream-demo-456` with the bash tool, then reply with exactly \"DONE\". Simple task.","summary":[],"outcome":{"type":"committed"}}
{"id":"effect-c9f4dfd9-75b8-5259-a72b-5fdf5a0c16b7","sessionId":"5154f63d-170d-c603-39eb-2c93d344bcbb","turnId":"turn-5897fc80fd36998c864932980727f83c","inputEntryId":"user-turn-5897fc80fd36998c864932980727f83c-1","createdAt":1794048315902,"updatedAt":1794048315928,"generationStatus":"completed","relatedEntryId":null,"type":"effect","title":"file_system.bash","detail":{"toolName":"file_system.bash","display":{"summary":"bash: echo stream-demo-456","content":null,"suffix":"","verb":"Running","message":"echo stream-demo-456","settledVerb":"Ran","settledMessage":"echo stream-demo-456","statusText":"Running command"},"kind":"shell","input":{"command":"echo stream-demo-456"}},"state":{"status":"completed","outputText":"stream-demo-456\n","approvalSource":"bypass","durationMs":0.0,"approvalType":"always","output":{"stdout":"stream-demo-456\n","stderr":"","output":"","truncated":false},"display":{"success":true,"verb":"Ran","message":"echo stream-demo-456","warnings":[],"approvalNote":null,"suffix":""},"decision":"execute"}}
{"id":"assistant-4d450127-8a30-5f28-a597-7151416a75bc","sessionId":"5154f63d-170d-c603-39eb-2c93d344bcbb","turnId":"turn-5897fc80fd36998c864932980727f83c","inputEntryId":"user-turn-5897fc80fd36998c864932980727f83c-1","createdAt":1794048318313,"updatedAt":1794048318313,"generationStatus":"completed","relatedEntryId":null,"type":"message","role":"assistant","content":[{"type":"text","text":"DONE"}],"source":"harness","userDisplayContent":null,"outcome":{"type":"committed"}}
```

`--output json` on a fresh 1-turn run (`vibe -p "Reply with exactly: OK" --output json --auto-approve`) → exit 0, stdout is one pretty-printed array `[ <user message entry>, <reasoning entry>, <assistant message entry> ]` (same entry shapes as above; assistant entry `{"type":"message","role":"assistant","content":[{"type":"text","text":"OK"}],"source":"harness","outcome":{"type":"committed"}, …}`). On a **resumed** session (`--resume <id> --output json`), the array contains every prior turn's entries too (9 entries / 3 turns observed; all share one `sessionId`). `--output streaming` on a resumed session emits only the new turn's entries. `--output text` prints just `OK`.

## 6. Suggested mapping to Sandcastle's `ParsedStreamEvent` (`src/AgentProvider.ts:36-48`)

Use `--output streaming` (NDJSON, one whole entry per line) as the print-command stream; parse each line as a `PublicHistoryEntry`:

| `ParsedStreamEvent` | vibe source | notes |
| --- | --- | --- |
| `text` | entry `type=="message" && role=="assistant"`: join `content[].text` (type `text`) with `"\n\n"` | one event per completed assistant entry; no deltas exist |
| `tool_call` | entry `type=="effect"`: `name = detail.toolName` (strip `file_system.` prefix if desired), `args` = kind-specific displayable field: `shell`→`detail.input.command`, `file_read`/`file_edit`/`file_write`→`detail.input.file_path`, `web_search`→`detail.input.query`, `web_fetch`→`detail.input.url`, fallback `detail.display.summary` (e.g. `"bash: echo …"`) or `JSON.stringify(detail.input)` | mirrors the existing `TOOL_ARG_FIELDS` convention (`src/AgentProvider.ts:107-113`) |
| `result` | last `message`/`role=="assistant"` entry **of the current turn** (`turnId` of the run, taken from the first `turn_start` entry), text joined as above; skip `outcome.type=="discarded"` | in `json` mode the array is whole-session, so filter by `turnId` exactly like `rust-src/headless_output.rs` `turn_entries` |
| `session_id` | `sessionId` field of any entry (constant per run; also in `export.json` `result.session_id`) | emit once, from the first line |
| `error` | two sources: (a) stdout entries `type=="notice" && level=="error"` → `message`; `type=="effect" && state.status=="failed"` → `state.error.message`; (b) process level: stderr line `Error: …` / `Stopped: …` + exit code (0/1/2/3/4 as above) — fail the run on non-zero, as other providers do | no error objects on stdout otherwise |
| `usage` | **not on stdout.** Options: add `--output-dir DIR` and read `export.json` → `result.usage {input_tokens, output_tokens, cached_input_tokens, total_tokens}` (+`cost_usd`, `steps`); or implement `parseSessionUsage` over the captured unified session (stats in `meta.json`; `AgentStatsSnapshot` fields `session_prompt_tokens/session_completion_tokens/session_cached_tokens` and per-turn `last_turn_*`, `vibe-src/app_server/models.py:441-471`) | map `IterationUsage{inputTokens, cacheCreationInputTokens, cacheReadInputTokens, outputTokens}` from the session-cumulative or `last_turn_*` buckets |
| `context_window` | **not on stdout.** The app-server `session/statsUpdated` notification carries `context_window: int` alongside `stats` (`vibe-src/app_server/protocol.py:3080-3083`) but the headless client consumes it only for budgets (`rust-src/headless/turn.rs`). Implement `parseSessionContextWindow` over the captured session (stats `context_tokens` = current context size; per ADR 0023 the figure wanted is the last model call) | same conclusion as the codex provider: no stream event |

`reasoning` entries (thinking) have no `ParsedStreamEvent` counterpart — drop them. `checkpoint`/`callback` entries are bookkeeping; drop (a `callback` in headless means a question tool that will be auto-denied).

## Appendix: empirical runs (all in a scratch dir, `MISTRAL_API_KEY` from the environment, never printed; captures scrubbed for the key before use — 0 occurrences)

1. `vibe -p "Reply with exactly: OK" --output json --auto-approve` → exit 0; stdout = pretty JSON array of 3 entries (user `message`/`turn_start`, `reasoning`, assistant `message`); stderr = config-warning line only.
2. Same prompt with a forced bash tool call, `--output json` → 5 entries: user message, reasoning, `effect` (`title`/`detail.toolName` `file_system.bash`, `detail.kind` `shell`, `detail.input.command`, `state.status` `completed`, `state.output.stdout`), reasoning, assistant message.
3. Same with `--output streaming` → the 4 NDJSON lines quoted in §5.
4. `--output text` → stdout exactly `OK`.
5. `--output streaming --model nonexistent-model-xyz` → exit 1, stdout empty, stderr `Error: Unknown model: nonexistent-model-xyz. Available: …`.
6. `--resume <sessionId-from-run-1> --output streaming -p "Reply with exactly: RESUMED-OK"` → only the new turn's 3 entries, all carrying the resumed `sessionId`.
7. `--resume <same> --output json` → full 9-entry history across 3 turns, single `sessionId`.
