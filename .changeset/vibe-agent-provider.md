---
"@ai-hero/sandcastle": minor
---

Add a built-in `vibe()` agent provider for the Mistral Vibe CLI (verified against vibe 3.0.4). `run({ agent: vibe("mistral-medium-3.5"), ... })` pipes the prompt to `vibe -p --output streaming` over stdin, renders the live NDJSON history entries (assistant text, tool calls, errors), and passes `--auto-approve` exactly when `dangerouslySkipPermissions` is set. Sessions are captured from the sandbox's `~/.vibe/logs/session/unified/<id>/` directory to the host store of the same layout (only the cwd fields in `meta.json` are rewritten), so `result.resume?.("...")` continues a session via `vibe --resume <id>`; fork is not supported and throws `ForkNotSupportedError` (`canFork: false`). Token usage and the context-window figure are read from the captured session journal's last usage line. `sandcastle init` offers "Mistral Vibe" with a `MISTRAL_API_KEY` env example and a uv-based Dockerfile.
