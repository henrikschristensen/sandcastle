---
title: "Empirical check: vibe -p session-id round-trip, captured stream, exit codes"
type: task
state: open
assignee: ""
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
