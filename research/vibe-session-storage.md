# Vibe 3.0.4 session storage: on-disk layout, transcript format, cwd, session-id semantics

Research for ticket `plans/vibe-agent-provider/tickets/03-vibe-session-storage.md` (wayfinder map: `plans/vibe-agent-provider/map.md`).

**Date:** 2026-11-07. **Vibe version tested:** 3.0.4 (nix store install, readable as source; cited below as `vibe-src` / `harness-src`).

## Sources (primary only)

- `vibe-src` = `/nix/store/yv9apsfc489whxasi5vjvdm42kdpgmlf-mistral-vibe-3.0.4/lib/python3.14/site-packages/vibe/...`, cited as `vibe-src/<path>:<line>`
- `harness-src` = `.../site-packages/mistralai_vibe_local_harness/vibe/...` (the "unified" session store the 3.0.4 CLI actually writes through), cited as `harness-src/<path>:<line>`
- `vibe --help` / `vibe -p --help` output of vibe 3.0.4 on this host (`vibe --version` → `vibe 3.0.4`)
- Strings embedded in the shipped Rust CLI binary `vibe-src/_bin/vibe-rs` (slash-command help, error messages)
- Structural inspection of existing session dirs under `~/.vibe/logs/session/` (131 legacy `session_*` dirs, 70 `unified/*` dirs; file names and `meta.json` key shapes only — no transcript content and nothing secret copied into this doc)
- Empirical `vibe -p` runs (commands and sanitized results in the appendix; run with `MISTRAL_API_KEY` already in the environment; `~/.vibe/.env` and the key were never read or printed)
- [docs.mistral.ai/vibe configuration reference](https://docs.mistral.ai/vibe/code/cli/configuration-reference) (`[session_logging]` table)
- [mistralai/mistral-vibe GitHub README](https://github.com/mistralai/mistral-vibe#readme) (programmatic-mode `--output-dir`/`export.json`/`--resume SESSION_ID` docs, exit codes, session scoping)
- [PyPI `mistral-vibe`](https://pypi.org/project/mistral-vibe/)

## Headline: 3.0.4 has TWO on-disk stores, and `-p` writes only the new one

Vibe 3.0.4 runs on the "unified" harness. Its live session store is **`$VIBE_HOME/logs/session/unified/<full-uuid>/`** — verified empirically: a fresh `vibe -p` run on this host created `~/.vibe/logs/session/unified/a087116d-b841-83cd-341a-3e483df5c256/` and **no** new legacy `session_*` dir (appendix, run 3). The legacy layout `session_<YYYYMMDD>_<HHMMSS>_<id8>/{messages.jsonl,meta.json}` still exists on disk from older versions and is still *read*: the unified runtime lists legacy sessions in the picker and **imports one into a new unified session on resume** — "the legacy execution engine has been removed" (`vibe-src/app_server/_legacy_import.py:1-9`). So Sandcastle capture/resume must target the unified store; the legacy format matters only for importing pre-3.0 sessions.

Root resolution: `VIBE_HOME` env var overrides the default `~/.vibe` (`vibe-src/utils/vibe_home.py:9-14`); `SESSION_LOG_DIR = $VIBE_HOME/logs/session` (`vibe-src/core/paths/_vibe_home.py:15`). `save_dir` defaults to that and is expanduser/resolved (`vibe-src/core/config/models.py:108-135`). Setting `VIBE_HOME` (or `[session_logging] save_dir`) inside a sandbox redirects all session storage to a known path.

## 1. Unified store (the one 3.0.4 writes; what Sandcastle must capture)

Layout, per `harness-src/_storage.py:2280` (`session_root = root / "unified" / session_id`) and confirmed on disk:

```
$VIBE_HOME/logs/session/                     ← save_dir (config: [session_logging] save_dir)
├── .session_index.json                      ← listing cache, keyed by dir name (vibe-src/core/session/session_index.py:19,151-153)
├── active/                                  ← leases: <uuid>.lock + <uuid>.lock.json (harness-src/_storage.py:1958-1959)
├── continue-pointers/                       ← -c/--continue pointers: sha256(terminal_key\0cwd) filename containing "<session_id>\n" (vibe-src/app_server/_continue_target.py:13,29-31,48-52)
├── .last_session/<n>                        ← recent session ids/short ids (observed; one file per seat)
├── session_*.json                           ← single-session export files (observed)
├── unified/
│   ├── .session-index.json                  ← unified listing cache (harness-src/_session_catalog.py)
│   ├── <full-uuid>/                         ← one session (dir name == session_id; pattern ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$, harness-src/_storage.py:142,5582-5584)
│   │   ├── CURRENT                          ← JSON pointer: {generation, manifest_sha256, session_id, snapshot_sequence, store_format: "mistral.vibe.unified-session-store/v1", store_format_minor: 10} (observed; harness-src/_storage.py:102,116,387-389)
│   │   ├── meta.json                        ← SessionMetadataV1: cwd, origin_cwd, root_session_id, parent_session_id, started_by_session_id, subagent_* , active_model, agent_name, hook_bindings, … (harness-src/_storage.py:772-800). The vibe-facing meta.json adds session_id, start_time, end_time, git_commit/branch, environment{working_directory}, origin_directory, username, child_sessions[], loops[], title, stats{}, total_messages, tools_available[], system_prompt (vibe-src/core/types.py:66-109; observed)
│   │   ├── journal/                         ← append-only record log: journal/<16-digit-sequence>.jsonl (harness-src/_session_catalog.py:73 pattern ^journal/[0-9]{16}\.jsonl$; written as f"{sequence+1:016d}.jsonl" at harness-src/_storage.py:~2349). Each line: {sequence, type, payload, record_sha256, previous_record_sha256, recovery_journal_record_version} (observed; payload types enum at harness-src/_storage.py:1528-1574). Observed record types in a 1-turn run: command_reserved, core_input, projection_delta, action_intent, action_result, receipt_succeeded
│   │   ├── generations/<16-digit>/          ← immutable generation manifests+snapshots, one per published checkpoint (harness-src/_storage.py:2339-2341)
│   │   ├── chunks/                          ← content-addressed transcript chunks, <64-hex-sha>.json, sealed at 64 KiB (harness-src/_storage.py:117-126, _CHUNK_FILE_PATTERN)
│   │   ├── tool-results/  scratchpad/  scheduled-loops.json   ← observed
│   │   └── (legacy runs additionally had attachments/ — see §3)
│   └── child-<24-hex-digest>/               ← subagent (task tool) sessions: same journal/chunks/generations/CURRENT/tool-results shape, no meta.json; deleted when the child closes (name from harness-src/_subagents/_operations.py:63 f"child-{digest[:24]}"; path resolution vibe-src/app_server/_subagent_runs.py:223-227; parent links via meta.json child_sessions: [{session_id, tool_call_id, agent, relative_path}], vibe-src/core/types.py:44-50)
└── session_<YYYYMMDD>_<HHMMSS>_<id8>/      ← LEGACY store (read/import only in 3.0.4), see §2
```

Append semantics: a resumed run **appends to the same unified dir** — new journal segments appear, `CURRENT` is bumped to a higher generation, `start_time` is unchanged, `end_time` is updated (observed, appendix runs 4-5: generation 8→20→32 in `a087116d-…`).

## 2. Legacy store (pre-3.0 sessions; still listed and imported on resume)

```
save_dir/session_<YYYYMMDD>_<HHMMSS>_<id8>/   ← dir name = f"{session_prefix}_{local timestamp}_{first 8 chars of session_id}"
                                               (glob used by readers: f"{prefix}_*_{short_id}", vibe-src/core/session/session_loader.py:199-200;
                                                shorten_session_id = session_id[:8], vibe-src/utils/session_id.py:6-10; format observed on 131 real dirs,
                                                e.g. session_20261025_080710_ed97971a ↔ session_id ed97971a-09ba-86b4-c28c-0db5a40f33fc)
├── messages.jsonl                           ← one JSON object per line (MESSAGES_FILENAME, vibe-src/core/session/session_index.py:21)
├── meta.json                                ← SessionMetadata, pretty-printed, atomically replaced (vibe-src/core/session/metadata.py:19-48)
└── attachments/                             ← images snapshotted as attachments/<sha1><ext>, referenced from message image blocks (vibe-src/core/session/image_snapshot.py:27-36)
```

`messages.jsonl` line schema (`LLMMessage`, vibe-src/core/types.py:205-230; verified against a real 378-line transcript — key sets per role observed):

- Every line: `role` ∈ {`system`,`user`,`assistant`,`tool`} (Role enum, vibe-src/core/types.py:140-145), `content` (string), `injected` (bool), `message_id` (uuid).
- `assistant` lines may add `reasoning_content`, `reasoning_message_id`, `tool_calls[]` = `{id, index, function:{name, arguments(json string)}, type:"function", presentation?}` (ToolCall, vibe-src/core/types.py:112-122).
- `tool` lines: `name`, `tool_call_id`, `tool_result` = `{output: dict, duration?, cancelled?, presentation?}` (PersistedToolResult, extra=forbid, vibe-src/core/types.py:185-190).
- `user` lines may add `images[]` (`{source:{kind:"file",path}|{kind:"inline",data}, alias, mime_type}`) and `resources[]` (ImageAttachment, vibe-src/core/types.py:155-183).
- `system` lines are dropped on load (`load_session` filters `role != "system"`, vibe-src/core/session/session_loader.py:262-266).
- Loadability rule: a dir is a valid session only if both files exist, every line parses, and the log is non-empty unless `meta.json.total_messages == 0` (vibe-src/core/session/session_loader.py:87-99).

`meta.json` (SessionMetadata, vibe-src/core/types.py:66-109; observed): `session_id` (full UUID), `parent_session_id`, `start_time`, `end_time`, `git_commit`, `git_branch`, **`environment: {working_directory: "<cwd>"}`**, **`origin_directory`** (where the session began; `environment.working_directory` "follows it as it moves", types.py:74-78), `username`, `child_sessions[]`, `loops[]`, `title`/`title_source`, `bumped_at`/`pinned_at`/`archived_at`/`seen_at`/`unseen_at`, `experiments`, `config` (full config snapshot incl. `session_logging`), `import_provenance`, `created_worktree`, `artifacts[]`, plus observed extras `stats{}` (token/cost counters incl. per-turn `last_turn_*`), `total_messages`, `last_message_fingerprint`, `tools_available[]`, `agent_profile`, `system_prompt`.

**cwd embedding points (exact JSON paths):** cwd lives in `meta.json` at `environment.working_directory` (current) and `origin_directory` (original); the listing cache mirrors them as `cwd`/`origin_directory` (vibe-src/core/session/session_index.py:60-95). **`messages.jsonl` does NOT embed cwd**: a recursive key scan of a real 378-line transcript found no `cwd`/`working_directory` keys (the only cwd-shaped field in the schema is `manual_shell.cwd`, vibe-src/core/types.py:193-206, absent in practice). The unified journal likewise carries no cwd (grep of a probe session's journal found none); its `meta.json` has `environment.working_directory` + `origin_cwd` (harness-src/_storage.py:773-776).

## 3. Config knobs

`[session_logging]` table (`SessionLoggingConfig`, vibe-src/core/config/models.py:108-135; docs.mistral.ai configuration reference):

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Saves sessions to disk. If `false`: `--continue`/`--resume` are refused ("Session logging is disabled. Enable it in config to use --continue or --resume", vibe-src/app_server/_unified_harness_backend_adapter.py:1741) and sessions go to a throwaway temp dir `vibe-session-logging-disabled-*` that is deleted on exit (vibe-src/app_server/_runtime.py:690-716,1008-1011) |
| `save_dir` | `~/.vibe/logs/session` (i.e. `$VIBE_HOME/logs/session`) | Where sessions are saved; expanduser+resolve |
| `session_prefix` | `"session"` | Legacy dir-name prefix only (glob patterns, session_loader.py:161,200) |
| `generate_titles` | `true` | LLM-generated titles for the resume picker |

## 4. Resume semantics (`--resume <SESSION_ID>`, `-c/--continue`)

- CLI surface: `--resume [<RESUME>]` — "Resume a session. Without SESSION_ID, shows an interactive picker"; `-c, --continue` — "Continue this terminal's last session in this folder, else the folder's most recent" (`vibe --help`). `-c` and the picker are **folder-scoped** ("Sessions are scoped per directory, so -c/--continue and the --resume picker only see sessions started inside that worktree"; "resume it explicitly by ID with --resume <ID>" to cross directories — mistral-vibe GitHub README). `--resume <id>` by contrast resolves **globally across save_dir** (legacy resolver matches exact full id, else unique `id[:8]` prefix across all sessions, error if ambiguous: vibe-src/core/session/session_interop.py:47-72; unified short-id glob: session_loader.py:199-200 + saved_sessions.py:33-46 full-id check against meta.json).
- **Accepted ids:** full UUID or the 8-char short id — both verified empirically (appendix runs 4-5).
- **Same directory on resume:** a resumed run appends to the same `unified/<uuid>/` dir (journal grows, `CURRENT` bumped, `start_time` unchanged, `end_time` updated) — verified empirically. For legacy sessions, resume imports the history into a **new** unified session (vibe-src/app_server/_legacy_import.py:1-9).
- **cwd on resume:** the resumed run executes in the session's recorded `environment.working_directory`, not the caller's cwd — verified empirically: launched from `/tmp/vibe-probe2` with `--resume <id of a session recorded in /tmp/vibe-probe>`, the agent answered `/tmp/vibe-probe` when asked its cwd (appendix run 6). Sandcastle must therefore keep the workspace at the same absolute path across runs (or accept that resume re-roots there). Listing-side, a session is offered from both `environment.working_directory` and `origin_directory` (session_loader.py:54-75).
- **Unknown id:** `Error: Session not found: <id>` (empirical, appendix run 7).
- **Concurrency lease:** `active/<uuid>.lock(.json)`; a second process resuming a live session gets "This session is open in another Vibe process. Close it there to continue here." (lease code harness-src/_storage.py:1951+; message string in `vibe-src/_bin/vibe-rs`). Lock json observed: `{acquired_at, lease_version:1, process_id, session_id}`.
- `-c` mechanics: per-(terminal,cwd) pointer file `continue-pointers/<sha256>` containing the session id, pruned after 30 days; falls back to the folder's most recent session (`vibe-src/app_server/_continue_target.py`).

## 5. Fork

- **No `-p`-mode fork flag.** Fork exists only in-session: `/branch` (alias `/fork`) — "Fork the current conversation into a new resumable session, leaving this session unchanged. Resume the copy with `vibe --resume <id>`" (string in `vibe-src/_bin/vibe-rs`; app-server method `session/fork`, vibe-src/app_server/protocol.py:202, server.py:1057-1059).
- A fork writes a **new** session dir with `parent_session_id`/`root_session_id` set (harness-src/_storage.py:786-787; adapter vibe-src/app_server/_unified_harness_backend_adapter.py:2351-2382) whose history is the source history truncated at a user-message anchor (`history_for_fork`, harness-src/_fork.py:31-53). The source session is left unchanged.
- `--worktree [NAME]` combines with `-c`/`--resume`: "the worktree is prepared first and the resume is then scoped to the worktree directory" (`vibe --help`).

## 6. Capture mechanism built into the CLI: `--output-dir DIR`

`vibe -p ... --output-dir DIR` writes, "on every exit", **`DIR/export.json`** (Vibe version, effective config with env/header values redacted, token usage, cost, `steps`, stop reason, outcome, warnings) **and a copy of the whole session journal to `DIR/session/`** (`vibe --help`; mistral-vibe README "Programmatic Mode"). Verified empirically (appendix run 8): `out/export.json` keys = `config, cost_usd, ended_at, error, exit_code, journal_dir, limits, outcome, schema_version, session_id, started_at, steps, stop_reason, usage, vibe_version, warnings`; `out/session/` contained the full unified dir (`chunks, CURRENT, generations, journal, meta.json, scheduled-loops.json`). README: the resume key is `session_id` in the first run's `export.json` ("start a new run with `--resume SESSION_ID`, taking the ID from `session_id` in the first run's export.json"); a resumed run's export shares the same `session_id`, counts only its own `steps`/`usage`/`cost_usd`, and its `journal_dir` holds the whole session. `--time-limit SECONDS` interrupts the run but keeps it resumable with `--resume` (`vibe --help`). Exit codes 0 finished / 1 usage-or-config error / 2 infrastructure / 3 limit-or-terminated / 4 aborted (README exit-code table).

## 7. What Sandcastle needs to know (implications)

1. Set `VIBE_HOME` (or `[session_logging] save_dir`) inside the sandbox to a fixed path; all session storage lands under `$VIBE_HOME/logs/session/unified/<uuid>/`. `session_logging.enabled` defaults to true; do not disable it or sessions go to a deleted temp dir and resume is refused.
2. Capture: either copy `$VIBE_HOME/logs/session/unified/` out of the sandbox after the run, or pass `--output-dir <dir>` and read `export.json` (`session_id` = resume key, usage/cost/stop-reason included) plus the copied `session/` journal.
3. Resume: `vibe -p --resume <full-uuid-or-first-8-chars> ...` — global across save_dir, appends to the same session dir, and **re-roots the run into the session's recorded `environment.working_directory`**, so the workspace must exist at the same absolute path in the resume sandbox.
4. Session id = full UUID in `meta.json`/`CURRENT`/dir name; short id (first 8 chars) also accepted. `child-<24hex>/` dirs beside sessions are subagent transcripts, linked from the parent's `meta.json` `child_sessions[]`; the harness deletes a closed child's dir, so capture must happen while/after the parent is alive or include them explicitly.
5. Legacy `session_<ts>_<id8>/{messages.jsonl,meta.json}` dirs (pre-3.0) are read-only inputs now: listed in the picker, imported into a new unified session on resume; `messages.jsonl` never embeds cwd — cwd is only `meta.json.environment.working_directory` (+`origin_directory`).
6. Live-session lease lives in `active/<uuid>.lock`; resuming a session another process holds fails with a clear error.

## Appendix: empirical runs (sanitized)

All runs: vibe 3.0.4, `MISTRAL_API_KEY` already in env (never printed), `--output text --auto-approve`, scratch cwds under `/tmp/vibe-probe*`:

1. `vibe --version` → `vibe 3.0.4`; `vibe --help` / `vibe -p --help` → flags quoted above.
2. Structural inspection of `~/.vibe/logs/session/`: 131 legacy `session_<YYYYMMDD>_<HHMMSS>_<id8>` dirs (each with `messages.jsonl` + `meta.json`), 70 `unified/<uuid>` dirs (plus `child-*`), `active/*.lock{,.json}`, `continue-pointers/<sha256>` files containing a session id, `.last_session/<n>` files, `.session_index.json` (126 entries, keyed by legacy dir name).
3. `cd /tmp/vibe-probe && vibe -p "Reply with exactly the single word PONG and nothing else."` → stdout `PONG`, exit 0; created `unified/a087116d-b841-83cd-341a-3e483df5c256/` (`environment.working_directory: /tmp/vibe-probe`, journal 2 segments, `CURRENT` generation 8); no new legacy dir.
4. Same cwd, `vibe -p "... OK2." --resume a087116d-b841-83cd-341a-3e483df5c256` → `OK2`; same unified dir, journal grew, `CURRENT` generation 20, `start_time` unchanged, `end_time` updated.
5. `cd /tmp/vibe-probe2 && vibe -p "... OK3." --resume a087116d` (short id, different cwd) → `OK3`; appended to the same dir (generation 32).
6. From `/tmp/vibe-probe2`, resumed with full id and asked "What is your current working directory?" → agent answered `/tmp/vibe-probe` (the session's recorded cwd, not the caller's).
7. `vibe -p "hi" --resume nonexistent-id-12345` → stderr `Error: Session not found: nonexistent-id-12345`.
8. `cd /tmp/vibe-probe && vibe -p "... OK4." --output-dir /tmp/vibe-probe/out` → `out/export.json` + `out/session/` copy of the unified dir; export keys and `session_id: 715fbf7c-…` as listed in §6.
