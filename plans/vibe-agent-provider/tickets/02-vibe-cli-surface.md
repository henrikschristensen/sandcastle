---
title: "Vibe print-mode CLI surface: prompt input, flags, exit codes"
type: research
state: closed
assignee: henrikschristensen
blocked_by: []
---

## Question

What is the full CLI surface of `vibe` 3.0.4 relevant to non-interactive (`-p`) runs? Specifically:

- Prompt input: `-p TEXT` argv only, or is stdin accepted in print mode? Any documented size limit?
- `--resume [SESSION_ID]` and `-c/--continue` semantics in `-p` mode; is there any fork flag in `-p` mode (in-session `/branch` exists)?
- `--model` — does it take a config alias or a canonical model name?
- `--auto-approve` / `--yolo` — exact behavior; any env equivalent (`VIBE_BYPASS_TOOL_PERMISSIONS`)?
- `--output text|json|streaming` — which are valid in `-p` mode?
- `--max-turns`, `--max-price`, `--max-tokens`, `--system-prompt-file`.
- `--trust` — is it needed for `-p` runs to avoid prompts?
- Exit codes: success vs agent error vs auth failure.
- Env vars that matter headless in a fresh sandbox: `VIBE_HOME`, `VIBE_ENABLE_TELEMETRY`, `VIBE_ENABLE_UPDATE_CHECKS`, `VIBE_ACTIVE_MODEL`, `LOG_LEVEL`, `MISTRAL_API_KEY`.

## Sources (primary only)

- `vibe --help`, `vibe -p --help`, and the argparse/click definitions in the installed source at `/nix/store/yv9apsfc489whxasi5vjvdm42kdpgmlf-mistral-vibe-3.0.4/lib/python3.14/site-packages/vibe`.
- https://docs.mistral.ai/vibe/code/overview and https://github.com/mistralai/mistral-vibe README.
- The `vibe:vibe` skill (load it) for cross-checking.

## Deliverable

Write findings to `research/vibe-cli-surface.md`: a flag-by-flag table with source citations and the answers above. Add a `## Findings` pointer to this ticket file and set `state: closed`.

## Findings

Full findings: [research/vibe-cli-surface.md](../../../research/vibe-cli-surface.md) (flag-by-flag table with per-claim citations to the installed 3.0.4 source, `vibe --help`, the `vibe-rs` binary, empirical sanitized runs, docs.mistral.ai, the GitHub README and PyPI).

Gist: `-p` takes an optional value — no text means the prompt is read from **stdin** (hard byte cap, error `piped prompt exceeds N bytes`; `--prompt-file PATH` is the alternative); empty stdin → exit 1. In `-p` mode `--resume` **requires** a session id (no picker, exit 1 without one) and there is **no fork flag** (fork is in-session `/branch` only); `-c` works via terminal/cwd pointers. `--model` takes a config **alias** (unknown alias → exit 1). `--auto-approve`/`--yolo` approves all tool calls; env equivalent `VIBE_BYPASS_TOOL_PERMISSIONS=true` confirmed; without it, headless runs **deny** any tool call that needs approval (run still exits 0) — so Sandcastle must pass `--auto-approve`. `--output text|json|streaming` all valid headless (streaming = NDJSON per entry; json = whole session array; `--output-dir` writes `export.json` with outcome/exit_code/usage). Exit codes: 0 finished, 1 usage/config **incl. missing or invalid MISTRAL_API_KEY (401)**, 2 infrastructure after retries, 3 limits/refusal/SIGTERM (`--time-limit` exits 3), 4 agent-socket abort. Headless env: `VIBE_HOME`, `MISTRAL_API_KEY`, `VIBE_ACTIVE_MODEL`, `VIBE_ENABLE_TELEMETRY=false`, `VIBE_ENABLE_UPDATE_CHECKS=false`, `LOG_LEVEL`; any config field is settable via `VIBE_*`. `--trust` only affects loading project-local `.vibe/` config — `-p` never prompts for trust.
