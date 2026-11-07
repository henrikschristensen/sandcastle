---
title: "The vibe print command: exact invocation, prompt delivery, flags, env defaults"
type: grilling
state: open
assignee: ""
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
