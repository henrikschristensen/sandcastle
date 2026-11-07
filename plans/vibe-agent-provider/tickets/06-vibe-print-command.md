---
title: "The vibe print command: exact invocation, prompt delivery, flags, env defaults"
type: grilling
state: closed
assignee: henrikschristensen
blocked_by: [01-vibe-p-output-schema, 02-vibe-cli-surface, 05-vibe-roundtrip-empirical]
---

## Question

What exact command does `buildPrintCommand` return for the `vibe()` provider? Decide, against the research tickets' findings:

- Prompt delivery: stdin if supported, else argv with the 120 KB guard mirroring `assertCursorPrintPromptFitsArgv` / `assertCopilotPrintPromptFitsArgv` in `src/AgentProvider.ts`.
- Base invocation in print mode: `vibe -p <prompt> --output <json|streaming>` (whichever the schema ticket shows is line-delimited and parseable).
- `--model <model>` mapping; `--auto-approve` (or `--yolo`) when `dangerouslySkipPermissions`; `--resume <id>` composition with the print flags (and fork, if ticket 10 decides it exists).
- Env defaults injected by the provider (`env`): `MISTRAL_API_KEY` passthrough expectation, `VIBE_ENABLE_TELEMETRY=false`, `VIBE_ENABLE_UPDATE_CHECKS=false`, anything else the CLI-surface ticket shows is needed headless.
- `VibeOptions` surface: `env`, `captureSessions`, `sessionStorage` overrides (host/sandbox dirs) — matching the other providers — plus any vibe-specific knob worth exposing (thinking level? max-turns?) or explicitly deferred (map fog).

Consult `/grilling` + `/domain-modeling`. Record the decision as the exact command string for fresh and resume forms, plus the options interface, in `## Resolution`.

## Resolution

Locked via grilling with the user (2026-11-07), one decision at a time:

1. **Prompt delivery: stdin via bare `-p`.** `buildPrintCommand` returns `{ command, stdin: prompt }` — the prompt is piped, never in argv. (Vibe's piped-stdin byte cap is undocumented but the error is a clean exit 1; `--prompt-file` exists as a future escape hatch.)
2. **Output: `--output streaming`** always — live NDJSON history entries; the only mode `parseStreamLine` can consume line-by-line.
3. **Permissions:** `--auto-approve` appended iff `dangerouslySkipPermissions` (mirrors cursor `--force` / copilot `--allow-all-tools`). Without it, vibe denies approval-needing tool calls while exiting 0.
4. **Resume/fork:** `resumeSession` → append `--resume <id>` (composes with all other flags; verified empirically). `resumeSession` + `forkSession` → throw `ForkNotSupportedError` (no `-p`-mode fork exists; ticket 10 sets `canFork: false`).
5. **Model:** `--model <model>` always (takes a config alias / catalog name).
6. **Env defaults:** provider `env` = `{ VIBE_ENABLE_TELEMETRY: "false", VIBE_ENABLE_UPDATE_CHECKS: "false" }`, merged with `options.env`, the env resolver, and sandbox env. `VIBE_HOME` left at default (`~/.vibe`); `MISTRAL_API_KEY` is the caller's (init envExample documents it).
7. **No `--output-dir`** on the command — `captureToHost` copies `$VIBE_HOME/logs/session/unified/<id>/` directly (written on every run regardless).
8. **`VibeOptions`:** minimal — `{ env?, captureSessions? (default true), sessionStorage?: { hostSessionsDir?, sandboxSessionsDir? } }`, matching the other providers. `--max-turns`/`--max-price`/`--agent` etc. deliberately not exposed (Sandcastle orchestrates iterations/timeouts itself).

Resulting command shapes (shell-escaped interpolations per `shellEscape`):

- Fresh AFK run: `vibe -p --output streaming --model '<model>' --auto-approve` + stdin prompt
- Without skip-permissions: same minus `--auto-approve`
- Resume: above + `--resume '<sessionId>'`
- Interactive (`buildInteractiveArgs`): `["vibe", "--model", model]` (+ prompt as positional initial prompt if given) — fog item, refined at implementation.
