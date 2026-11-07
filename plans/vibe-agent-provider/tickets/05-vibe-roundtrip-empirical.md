---
title: "Empirical check: vibe -p session-id round-trip, captured stream, exit codes"
type: task
state: closed
assignee: henrikschristensen
blocked_by: [01-vibe-p-output-schema, 02-vibe-cli-surface, 03-vibe-session-storage]
---

## Question

Empirically verify (per the checklist in `docs/agents/adding-an-agent-provider.md`, resume must be verified before implementation) that a Vibe `-p` run's session ID round-trips through `--resume`:

1. Run `vibe -p "Reply with exactly: OK" --output json --auto-approve` (the API key is already in the env — never print it, never read `~/.vibe/.env`). Record stdout, stderr, and exit code.
2. Extract the session ID from the stream and/or from the new directory under `~/.vibe/logs/session/`. Note which one `--resume` accepts.
3. Run `vibe -p "What was my previous message?" --resume <id> --output json --auto-approve` — confirm the answer references the first prompt (true continuation) and whether the session ID stays the same. Repeat from a different cwd.
4. Record exit codes for: a successful run, an auth failure (e.g. `MISTRAL_API_KEY=invalid`), and a bad `--model` alias.
5. Check whether any `-p`-mode fork flag exists; if not, say so explicitly.
6. Capture the resulting `messages.jsonl` / `meta.json` structure (sanitized) for the storage-design ticket.

## Deliverable

Findings as a comment-equivalent section (`## Resolution`) in this ticket file plus sanitized raw samples under `research/vibe-roundtrip/` in the working tree. Set `state: closed` when done. AFK — the key is available; do not ask the user.

## Resolution

Done empirically on vibe 3.0.4 with a throwaway `VIBE_HOME`; full write-up + sanitized raw samples in [`research/vibe-roundtrip/README.md`](../../../research/vibe-roundtrip/README.md).

- **Round-trip holds.** `sessionId` on every streamed line == unified dir name == `meta.json.session_id`. `--resume <full-uuid>` continues the same session (same id, appended; verified by the agent recalling the first prompt). `--resume` also accepts the **first 8 chars**. Works from a different cwd — the run re-roots into the session's recorded `working_directory`, so resume requires the workspace at the same absolute path (bind-mount providers already satisfy this).
- **Exit codes:** 0 success; 1 usage/config incl. invalid `MISTRAL_API_KEY` and unknown `--model` alias (empty stdout, `Error: …` on stderr); 2 infra; 3 limits; 4 abort.
- **No fork flag in `-p` mode** (`vibe -p --help` has none; fork is in-session `/branch` only) → `canFork: false` for the provider.
- **`--output-dir DIR`** writes `export.json` (`session_id`, `usage{input_tokens, output_tokens, cached_input_tokens, total_tokens}`, `cost_usd`, `outcome`, `stop_reason`, `error`) plus a full copy of the unified session dir on every exit — the capture hook; usage/context-window are not on stdout.
- Session layout confirmed: `$VIBE_HOME/logs/session/unified/<uuid>/{meta.json, journal/*.jsonl, chunks/, generations/, CURRENT}`; cwd only in `meta.json` (`environment.working_directory`).
