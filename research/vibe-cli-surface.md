# Vibe 3.0.4 print-mode (`-p`) CLI surface — research findings

Ticket: `plans/vibe-agent-provider/tickets/02-vibe-cli-surface.md`

**Date:** 2026-11-07. **Version under test:** `vibe 3.0.4` (nix store install; PyPI currently ships 3.1.0, so re-verify against the version Sandcastle will pin).

**Architecture note (matters for sourcing):** the `vibe` console script is a thin Python launcher that `exec`s a bundled **Rust binary** (`vibe/_bin/vibe-rs`), which parses argv (clap), reads the prompt, spawns/drives a Python **app-server** (`vibe-app-server`, entry `vibe.app_server.stdio:main`) over JSON-RPC, and prints the result. The Rust source (`cli-rust/`, e.g. `src/headless_prompt.rs`) is **not shipped in the wheel and not in the public GitHub repo** — so argv parsing is cited from `vibe --help` and strings/symbols in the binary; run semantics (outcomes, exit codes, config, sessions) live in the Python package and are cited by file:line. [S1][S2][S3]

## Sources

- **[S1] Installed source** — `/nix/store/yv9apsfc489whxasi5vjvdm42kdpgmlf-mistral-vibe-3.0.4/lib/python3.14/site-packages/vibe/`, cited as `vibe/<file>:<line>`.
- **[S2] CLI help** — `vibe --help` and `vibe -p --help` on vibe 3.0.4 (identical output; `-p` takes an *optional* value, so help does not differ). Captured 2026-11-07.
- **[S3] Rust binary** — strings/symbols of `vibe/_bin/vibe-rs` (e.g. `vibe_rs::headless_prompt::read_stdin_prompt` / `parse_piped_prompt`, `src/headless_prompt.rs`; error strings quoted verbatim).
- **[S4] Empirical runs** — `vibe -p` executed 2026-11-07 in a scratch dir with the session env as-is; stdout captured and sanitized (any API-key value replaced with `<REDACTED_API_KEY>` before recording). Exit codes and stderr quoted verbatim. No `.env` file was read; auth-failure probes used a throwaway `VIBE_HOME` with `MISTRAL_API_KEY` removed or set to a dummy string.
- **[S5] Mistral docs, "Work with the CLI"** — https://docs.mistral.ai/vibe/code/cli/work-with-cli (programmatic mode, trust, options).
- **[S6] Mistral docs, "Vibe Code overview"** — https://docs.mistral.ai/vibe/code/overview.
- **[S7] GitHub README** (tracks latest release) — https://github.com/mistralai/mistral-vibe/blob/main/README.md, sections "Programmatic Mode" and "Exit Codes".
- **[S8] PyPI** — https://pypi.org/project/mistral-vibe/ (latest 3.1.0; needs GIL-enabled Python ≥ 3.12).
- **[S9] `vibe:vibe` skill** — cross-check only, not treated as primary.

## Answers to the ticket's questions

### Prompt input

- `-p TEXT` / `--prompt TEXT` argv, **and** stdin: with `-p` and no text, the prompt is **read from stdin** (piped input). Help for `--prompt-file` says "instead of -p TEXT or stdin" [S2]; binary has `headless_prompt::read_stdin_prompt` / `parse_piped_prompt` [S3]; docs: "pipe it on stdin with `-p` and no text" [S5]; README: "With `-p` and no text, the prompt is read from stdin" [S7]. Empirically `printf '…' | vibe -p` works, exit 0 [S4].
- `-p` with **empty** stdin → `Error: No prompt provided for programmatic mode`, **exit 1** [S4]; binary also has "Pass either -p TEXT or --prompt-file" [S3].
- `--prompt-file PATH` reads the prompt from a file (works headless, exit 0) [S2][S4][S7]. Precedence: `-p TEXT` > `--prompt-file` > stdin (per help wording "instead of -p TEXT or stdin" [S2]).
- **Size limit on piped stdin:** yes, a hard byte cap exists — binary error `Error: piped prompt exceeds <N> bytes` and `Error: piped prompt is not valid UTF-8` (`src/headless_prompt.rs`) [S3]. The numeric constant is compiled into the Rust binary and is not in the shipped wheel or public repo, so it could not be sourced exactly; treat very large piped prompts as unsupported and use `--prompt-file` instead. No documented limit for `-p TEXT` argv (bounded by the OS argv limit).
- Positional `[INITIAL_PROMPT]` is the *interactive* initial prompt; in headless mode the prompt comes from `-p`/`--prompt-file`/stdin only [S2].

### `--resume` / `-c` in `-p` mode

- `vibe -p TEXT --resume <SESSION_ID>` works (exit 0, session continued) [S4]. `--resume` **without** an ID in `-p` mode is rejected: `Error: --resume requires a session ID in programmatic mode`, exit 1 (the interactive picker is not available headless) [S2][S3][S4].
- Unknown ID → `Error: Session not found: <id>`, exit 1 [S4]; resolution is by id via `meta.json` under the session save dir (`vibe/core/session/saved_sessions.py:26-46`, `session_index.py:20-21`).
- `-c` / `--continue` works in `-p` mode (exit 0) [S4]: resumes this terminal's last session in the cwd (pointer file under `continue-pointers/`, keyed by SHA-256 of terminal+cwd), else the folder's most recent session (`vibe/app_server/_continue_target.py`). Terminal key is the tty (or `VIBE_TERMINAL_KEY`) [S9]. In a fresh sandbox with no prior session, `-c` has nothing to continue (error `nothing_to_continue` per `harnessCode` in `_continue_target.py:14`).
- `--worktree` combines with `-c`/`--resume`: worktree prepared first, resume then scoped to it [S2].
- **Fork in `-p` mode: there is no fork/branch flag** — `--help` lists none [S2]; forking exists only in-session via `/branch` (alias `/fork`) [S9]. For Sandcastle this means resume is by session id only; a "fork" would need a new session seeded from the old one (consistent with ADR 0018's session-only fork).
- `--model` combined with resume: binary string `--model only applies to a new session` [S3]; help: "(headless mode only, new sessions)" [S2].

### `--model`

- Takes a config **alias** (the `alias` field of a `[[models]]` entry, e.g. `mistral-medium-3.5`), not a canonical API name; "Not saved as the default" [S2][S7]. Unknown alias → `Error: Unknown model: <name>. Available: …`, **exit 1** (usage error) [S4]. Env equivalent: `VIBE_ACTIVE_MODEL` (maps to the `active_model` config field) [S1 `vibe/core/config/vibe_schema.py:551`, env layer `vibe/core/config/layers/environment.py`].

### `--auto-approve` / `--yolo` / env equivalent

- `--auto-approve` (alias `--yolo`) approves all tool calls without prompting for the selected agent [S2][S7]. Resolution: `(requested or config.bypass_tool_permissions) and config.enable_auto_approve` — i.e. `enable_auto_approve = false` (admin policy) clamps both flag and config (`vibe/app_server/_runtime.py:2483-2494`) [S1]; docs repeat this [S5].
- **Env equivalent: `VIBE_BYPASS_TOOL_PERMISSIONS=true`** works — every config field is overridable via `VIBE_`-prefixed env vars (case-insensitive, empty values ignored, nested via `__`) [S1 `vibe/core/config/layers/environment.py:16-24`; field `bypass_tool_permissions` at `vibe_schema.py:932`]. Empirically confirmed: with a fresh `VIBE_HOME`, `VIBE_BYPASS_TOOL_PERMISSIONS=true vibe -p "…touch…"` ran the tool [S4].
- Headless approval semantics (important for Sandcastle): programmatic mode disables interactive tools and "nobody can answer an approval prompt, so Vibe denies any tool call that needs one" [S5]. Empirically: on a fresh `VIBE_HOME` without the flag, a non-allowlisted command (`touch …`) was **denied** (`tool_denied: Tool execution denied by approval callback` in the assistant output, run still exit 0); with `--auto-approve` it ran [S4]. Note: default allowlist commands (`echo`, `cd`, `git diff/log/status`, read-only commands like `ls`, `cat`, `rg`…) resolve to `ALWAYS` without approval [S1 `vibe/core/tools/builtins/bash.py:98-100, 685-687`], so "no flag" does not mean "no tools" — it means "allowlisted/safe tools only". Default agent in `-p` is `default_agent` config (`accept-edits` unless changed), which auto-approves file edits only [S5][S7][S9]. `--smart-approve` also exists (classifier auto-runs safe calls) [S2].

### `--output text|json|streaming`

- All three valid in `-p` mode; default `text` [S2]. Empirically all three work, exit 0 [S4]:
  - `text` — final answer as plain text on stdout.
  - `json` — pretty-printed JSON **array of session entries** (user `message`, `reasoning`, assistant `message`, `effect` tool entries…) printed at the end [S4]; README: "json: All messages as JSON at the end… on a resumed session json holds the whole session" [S7].
  - `streaming` — newline-delimited JSON, one entry object per line as the run progresses [S2][S4][S7]; on resume, `text`/`streaming` cover only the new run [S7].
- `--output-dir DIR` writes `export.json` + a copy of the session journal (`session/`) on **every** exit (except argparse rejections) [S2][S7]; `export.json` schema v1 contains `outcome`, computed `exit_code`, `session_id`, `usage`, `cost_usd`, `steps`, `stop_reason`, `limits`, redacted `config`, `warnings`, `subagents` [S1 `vibe/app_server/run_export.py`]; empirically produced exactly that [S4].

### `--max-turns`, `--max-price`, `--max-tokens`, `--system-prompt-file` (plus `--time-limit`)

- All headless-only flags [S2]. `--max-turns 0` run ended with `Stopped: turn_limit` on stderr, **exit 3** [S4]; README documents outcomes `turn_limit` / `price_limit` / `token_limit` for the three caps [S7]. `--time-limit SECONDS` "interrupt the run once SECONDS have passed, write the export and exit 3; SIGTERM stops the run the same way" [S2][S5][S7].
- `--system-prompt-file PATH` replaces Vibe's own system-prompt instructions with the file's text (project context and AGENTS.md still follow); empty/unreadable file is a usage error [S2][S7].
- `--max-price` caveat from docs: price values come from config and can be missing/outdated — treat cost as indicative [S5].

### `--trust`

- Needed to **load project-local config** (`.vibe/` in cwd) in a `-p` run: "Trust enforcement applies in both interactive and programmatic modes, but the confirmation prompt only appears interactively. In programmatic mode, use `vibe --trust` to grant temporary trust for the current invocation only" [S5]. Without it, `-p` never prompts and treats cwd as untrusted (project `.vibe/` ignored) [S5][S9]; the Rust side has `headless_trust.rs` (`extend_trusted`) for the `--trust` path [S3]. It does not affect the approval behavior above — that is `--auto-approve` / `VIBE_BYPASS_TOOL_PERMISSIONS` territory.

### Exit codes

Taxonomy defined in `vibe/app_server/run_export.py:30-77` (each `RunOutcome` maps to one exit code) and documented in README "Exit Codes" [S7]:

| Exit | Outcome(s) | Meaning | Empirical confirmation [S4] |
|---|---|---|---|
| 0 | `finished` | agent finished | plain `-p` run → 0 |
| 1 | `usage_error`, `config_error` | run could not start as asked (bad flags, no prompt, unknown model/session, missing or invalid API key) | no prompt → 1; `--resume` w/o id → 1; unknown model alias → 1; unknown session id → 1; missing `MISTRAL_API_KEY` → 1 ("Missing MISTRAL_API_KEY environment variable for mistral provider"); **invalid key at the API (401) → 1** ("Invalid API key (from env var MISTRAL_API_KEY)") |
| 2 | `infrastructure_failure` | model API failed after its retries, or runtime failed | not exercised (would need a real API outage) |
| 3 | `turn_limit`, `token_limit`, `price_limit`, `deadline`, `terminated`, `length`, `refusal` | agent stopped without finishing (a limit or refusal); its partial work is still its own | `--max-turns 0` → 3, stderr `Stopped: turn_limit`; `--time-limit`/SIGTERM → 3 per help [S2] |
| 4 | `aborted` | the server behind `--agent-socket` aborted the run | n/a (experimental flag, not used) |

Note: auth failures (missing key, 401) are **exit 1 (config_error)**, not 2 — verified empirically [S4]. Separately, the app-server process itself exits `128+SIGTERM` (143) on SIGTERM [S1 `vibe/app_server/_termination.py:21,97`], but the *CLI* maps a SIGTERM-stopped run to outcome `terminated`, exit 3 [S2]. "Stopped: <reason>" is printed on stderr; only argparse-level rejections exit 1 without an `export.json` [S7].

### Env vars that matter headless in a fresh sandbox

| Env var | Effect | Source |
|---|---|---|
| `MISTRAL_API_KEY` | API key for the default `mistral` provider (`api_key_env_var` default; also loadable from `$VIBE_HOME/.env`, which is never read here) | [S1 `vibe/core/config/_defaults.py:9`, `vibe_schema.py:178`; S5] |
| `VIBE_HOME` | Overrides `~/.vibe` (config, sessions under `logs/session/…`, trust db, logs). Fresh sandbox: point it at a writable dir | [S1 `vibe/utils/vibe_home.py:11-14`, `vibe/core/paths/_vibe_home.py:13-20`; S2 `--workdir` shows the `VIBE_CWD` pattern] |
| `VIBE_ACTIVE_MODEL` | Overrides `active_model` (alias) | [S1 `vibe_schema.py:551` + env layer] |
| `VIBE_ENABLE_TELEMETRY` | `enable_telemetry` (default `true`) — set `false` to disable telemetry | [S1 `vibe_schema.py:938` + env layer] |
| `VIBE_ENABLE_UPDATE_CHECKS` | `enable_update_checks` (default `true`) — set `false` to skip the daily PyPI/uv upgrade poll (non-interactive sandbox: no prompt is possible) | [S1 `vibe_schema.py:995` + env layer; S6] |
| `VIBE_BYPASS_TOOL_PERMISSIONS` | `bypass_tool_permissions` (default `false`) — env equivalent of `--auto-approve`; clamped by `enable_auto_approve` | [S1 `vibe_schema.py:932`, `_runtime.py:2483-2494`] |
| `LOG_LEVEL` | Log level for `$VIBE_HOME/logs/vibe.log` (`DEBUG|INFO|WARNING|ERROR|CRITICAL`, default WARNING; invalid → WARNING) | [S1 `vibe/observability/logging.py:117,135-136`; S9] |
| any `VIBE_<FIELD>` | Every `config.toml` field is overridable via `VIBE_` prefix, case-insensitive, `__` for nesting, empty values ignored (e.g. `VIBE_SESSION_LOGGING__ENABLED=false`) | [S1 `vibe/core/config/layers/environment.py:16-40`] |

Session storage location for resume: `$VIBE_HOME/logs/session/` (override `session_logging.save_dir`); observed 3.0.4 layout is `logs/session/unified/<session-id>/` containing `meta.json`, `CURRENT`, `journal/*.jsonl`, `generations/<n>/…`, `chunks/*.json` (plus `logs/session/active/` pointer and `continue-pointers/` for `-c`) [S4][S1 `vibe/core/paths/_vibe_home.py:15`, `vibe/core/session/session_index.py:20-21`]. The older single `messages.jsonl`-per-session-dir layout is superseded by the unified journal in 3.0.4 — relevant to ticket 03.

## Flag-by-flag table (headless-relevant surface of `vibe` 3.0.4)

| Flag | Value | Headless (`-p`) behavior | Source |
|---|---|---|---|
| `-p`, `--prompt` | `[TEXT]` optional | Headless mode: prompt from TEXT, else stdin, else error exit 1. One-shot, prints response, exits | [S2][S3][S4][S5][S7] |
| `--prompt-file` | `PATH` | Headless prompt from file instead of `-p TEXT`/stdin | [S2][S4][S7] |
| `--output` | `text\|json\|streaming` (default `text`) | Headless output format; see above | [S2][S4][S7] |
| `--output-dir` | `DIR` | Write `export.json` + `session/` journal copy on every exit | [S2][S1 `run_export.py`][S4][S7] |
| `--max-turns` | `N` | Cap assistant turns; outcome `turn_limit`, exit 3 | [S2][S4][S7] |
| `--max-price` | `DOLLARS` | Cap cost; outcome `price_limit`, exit 3; prices indicative | [S2][S5][S7] |
| `--max-tokens` | `N` | Cap total prompt+completion tokens of the run; outcome `token_limit`, exit 3 | [S2][S7] |
| `--time-limit` | `SECONDS` | Deadline; writes export, exit 3; SIGTERM same | [S2][S5][S7] |
| `--system-prompt-file` | `PATH` | Replace built-in system prompt text; empty/unreadable = usage error | [S2][S7] |
| `--model` | `ALIAS` | Model **alias** for this run (new sessions only; not saved); unknown alias exit 1 | [S2][S3][S4][S7] |
| `--agent` | `NAME` | Builtin `ask`, `accept-edits`, `smart-approve`, `auto-approve` or custom; default = `default_agent` config (`accept-edits`) | [S2][S5][S7] |
| `--auto-approve`, `--yolo` | flag | Approve all tool calls; clamped by `enable_auto_approve=false` | [S2][S1 `_runtime.py:2483`][S4][S5][S7] |
| `--smart-approve` | flag | Classifier auto-runs safe calls, prompts for risky ones | [S2] |
| `--enabled-tools` / `--disabled-tools` | `TOOL` repeatable | In headless, `--enabled-tools` disables all others; glob/`re:` patterns | [S2][S7] |
| `-c`, `--continue` | flag | Resume this terminal's last session in cwd, else folder's latest; works with `-p` | [S2][S1 `_continue_target.py`][S4] |
| `--resume` | `[SESSION_ID]` optional | In `-p`: **ID required** (no picker), exit 1 otherwise; unknown id exit 1; no fork flag exists | [S2][S3][S4] |
| `--trust` | flag | Trust cwd for this invocation only (loads project `.vibe/`); `-p` never prompts for trust | [S2][S5][S9] |
| `--workdir` | `DIR` | chdir before running; env `VIBE_CWD` | [S2] |
| `--worktree` | `[NAME]` optional | Run in a git worktree under `$VIBE_HOME/worktrees`; combines with `-c`/`--resume` | [S2] |
| `--add-dir` | `DIR` repeatable | Extra working dir for file access (implicitly trusted) | [S2] |
| `-v`, `--version` | flag | Print version (`vibe 3.0.4`) | [S2][S4] |
| `--setup`, `vibe update`/`--check-upgrade`, `vibe mcp …`, `vibe config …` | — | Non-session subcommands/flags (auth setup, upgrade check, MCP config, config schema) | [S2] |

## Implications for the Sandcastle provider (feeds tickets 06/10)

- Print command shape: `vibe -p <prompt> --output streaming --auto-approve --output-dir <dir>` (streaming = NDJSON of session entries, the natural parse target; `json` for whole-session dumps; exit code from `export.json.outcome`).
- Always pass `--auto-approve` (or `VIBE_BYPASS_TOOL_PERMISSIONS=true`): without it, any non-allowlisted tool call in `-p` mode is silently denied to the agent (run still exits 0) [S4][S5].
- Resume = `vibe -p TEXT --resume <id>`; there is no fork flag in `-p` mode; `-c` depends on terminal/cwd pointers that won't exist in a fresh sandbox, so use explicit `--resume <id>` [S4].
- Set headless env in the sandbox: `VIBE_HOME` (writable), `MISTRAL_API_KEY`, `VIBE_ENABLE_TELEMETRY=false`, `VIBE_ENABLE_UPDATE_CHECKS=false`, optionally `LOG_LEVEL`. Expect exit 1 for auth/config problems, 3 for limits, 2 for API/runtime failure after retries [S1 `run_export.py`][S4].
- Prompt via argv `-p TEXT` (OS argv limit) or `--prompt-file`; stdin works but has a hard (unsourced) byte cap — prefer argv/file for large prompts [S3][S4].
