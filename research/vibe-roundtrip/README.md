# Empirical `vibe -p` round-trip results (Vibe 3.0.4)

Resolves wayfinder ticket `plans/vibe-agent-provider/tickets/05-vibe-roundtrip-empirical.md`. All runs used a throwaway `VIBE_HOME` (`/tmp/vibe-roundtrip/vibehome`) and workdir; `MISTRAL_API_KEY` was used in-env only and every captured file was scrubbed for its value (grep-verified zero occurrences). Raw sanitized samples sit beside this file.

## Runs

| Run | Command (essence) | Exit | Result |
| --- | --- | --- | --- |
| 1 | `vibe -p "Reply with exactly: OK" --output streaming --auto-approve` | 0 | 3 NDJSON lines (`run1.out`): user `message`, `reasoning`, assistant `message` ("OK"). Every line carries `sessionId: 962f53da-…-7758f813def0`. Session written to `$VIBE_HOME/logs/session/unified/<full-uuid>/` (`meta.json`, `journal/*.jsonl`, `chunks/`, `generations/`, `CURRENT`). |
| 2 | `vibe -p "What was my previous message?…" --resume <full-uuid> --output streaming --auto-approve` (same cwd) | 0 | Same `sessionId`; assistant answered "Your previous message was 'Reply with exactly: OK'." — true continuation, appended to the same session dir (`run2.out`). |
| 3 | Same `--resume <full-uuid>` from a **different cwd** | 0 | Same `sessionId`; works — the run re-roots into the session's recorded `working_directory` (`run3.out`). |
| 4 | `--resume <first-8-chars>` | 0 | Accepted; `--output text` printed `Hi` (`run4.out`). |
| 5 | `MISTRAL_API_KEY=invalid-key vibe -p "hi" --auto-approve` (fresh `VIBE_HOME`) | 1 | Empty stdout; stderr `Error: Invalid API key (from env var MISTRAL_API_KEY)…` (`run5.err`). |
| 6 | `vibe -p "hi" --model nonexistent-model-xyz --auto-approve` | 1 | stderr `Error: Unknown model: nonexistent-model-xyz. Available: glm-5-3, mistral-large-4-0-3, mistral-medium-3.5, …` (`run6.err`). |
| 7 | `vibe -p "…PONG" --output streaming --auto-approve --output-dir DIR` | 0 | `DIR/export.json` + full `DIR/session/` copy of the unified session dir (`export.json` sample with `config` stripped). |

## Answers to the ticket's questions

1. **Session-id round-trip: YES.** The `sessionId` on every streamed line equals the unified dir name and `meta.json.session_id`; `--resume` accepts the full UUID **or its first 8 chars**, continues the same session (same id, appended), and works from any cwd (re-roots to the recorded `working_directory` — so Sandcastle must mount/sync the workspace at the same absolute path, which bind-mount providers already do).
2. **Exit codes:** 0 success; 1 usage/config **including auth failure and unknown model** (stderr `Error: …`, empty stdout); 2 infrastructure; 3 limits/stopped; 4 abort (per research ticket 02).
3. **Fork in `-p` mode: NONE.** `vibe -p --help` has zero fork flags; forking exists only as in-session `/branch`. → provider should declare `canFork: false` (ADR 0021 precedent).
4. **`--output-dir DIR`** writes `export.json` (`outcome`, `stop_reason`, `error`, `session_id`, `usage{input_tokens, output_tokens, cached_input_tokens, total_tokens}`, `cost_usd`, `steps`) plus a copy of the whole session dir on **every** exit — the natural capture hook for host↔sandbox transfer, and the source for `parseSessionUsage`/`parseSessionContextWindow` (usage is not on stdout).
5. **cwd embedding:** only `meta.json` (`environment.working_directory`, plus `origin_directory`); the journal does not embed cwd (per ticket 03) — but the resume re-rooting above means the host-side captured session must be resumed where the path matches, or the rewrite must handle it.

## Notes for the design tickets

- Stream parsing uses `--output streaming` (live NDJSON, one whole history entry per line at `generationStatus=="completed"`); `session_id` comes from the first line's `sessionId`; text from assistant `message` content `text` blocks; tool calls from `effect` entries; errors from `notice level=="error"` / `effect state.status=="failed"` on stdout **and** stderr+exit-code at run level.
- Default model with an empty config is the routed default (`mistral-large-4-0-3` alias observed; `auto_compact_threshold` 800000) — `--model` takes an alias from the model catalog.
