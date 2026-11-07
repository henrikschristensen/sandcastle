---
title: "Vibe session storage: on-disk layout, transcript format, cwd, session-id semantics"
type: research
state: closed
assignee: henrikschristensen
blocked_by: []
---

## Question

How does Vibe 3.0.4 persist sessions on disk, and what does Sandcastle need to know to capture and resume them?

- Layout under `~/.vibe/logs/session/` (`save_dir` / `session_prefix` config): directory naming (`session_<timestamp>_<id8>`), files inside (`messages.jsonl`, `meta.json`, `child-*` locks for subagents, `attachments/`).
- `meta.json`: `session_id` (full UUID) vs the short id in the dir name; `environment.working_directory` — is cwd recorded here, and does `messages.jsonl` embed cwd anywhere?
- `messages.jsonl` line schema: roles, content blocks, tool calls, usage fields per line.
- Resume semantics: does `--resume <SESSION_ID>` resolve by full id globally (not folder-scoped)? Does a resumed session append to the same directory? What happens when resumed from a different cwd?
- Fork: is there a `-p`-mode fork? What does in-session `/branch` write?
- Config knobs: `[session_logging] save_dir`, `session_prefix`, `enabled`.

## Sources (primary only)

- Installed source at `/nix/store/yv9apsfc489whxasi5vjvdm42kdpgmlf-mistral-vibe-3.0.4/lib/python3.14/site-packages/vibe` (session logging module).
- Structural inspection of existing session dirs under `~/.vibe/logs/session/` — file names and `meta.json` fields only; do not copy transcript content or anything secret into the findings.
- https://docs.mistral.ai/vibe and the mistral-vibe repo.

## Deliverable

Write findings to `research/vibe-session-storage.md`: layout diagram, file formats, cwd embedding points (exact JSON paths), resume/fork semantics, each claim cited. Add a `## Findings` pointer to this ticket file and set `state: closed`.

## Findings

Full findings with primary-source citations: [`research/vibe-session-storage.md`](../../../research/vibe-session-storage.md).

Gist: vibe 3.0.4 writes sessions only to the **unified store** `$VIBE_HOME/logs/session/unified/<full-uuid>/{CURRENT, meta.json, journal/<seq16>.jsonl, generations/, chunks/, tool-results/, scratchpad/, scheduled-loops.json}` (store format `mistral.vibe.unified-session-store/v1`, minor 10); the legacy `session_<YYYYMMDD>_<HHMMSS>_<id8>/{messages.jsonl,meta.json}` dirs are read-only and imported into a new unified session on resume. cwd is recorded only in `meta.json` at `environment.working_directory` (plus `origin_directory`); `messages.jsonl` never embeds cwd. `--resume` accepts the full UUID or its first 8 chars, resolves globally across `save_dir` (only `-c`/the picker are folder-scoped), appends to the same session dir, and re-roots the run into the session's recorded working directory (verified empirically); unknown ids error with `Session not found`. No `-p` fork — in-session `/branch`/`/fork` writes a new session with `parent_session_id` set. Config: `[session_logging] enabled` (default true; false ⇒ throwaway temp store, no resume), `save_dir` (default `$VIBE_HOME/logs/session`), `session_prefix` (legacy naming), `generate_titles`; `VIBE_HOME` env redirects everything. Best capture hook: `--output-dir DIR` writes `export.json` (incl. `session_id` = resume key) plus a full copy of the session dir to `DIR/session/`. Subagent runs live in sibling `unified/child-<24hex>/` dirs linked from the parent's `meta.json.child_sessions[]`.
