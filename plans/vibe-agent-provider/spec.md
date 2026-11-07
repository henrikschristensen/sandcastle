# Spec: Mistral Vibe CLI as a built-in Sandcastle agent provider

Originating request: [Support Mistral Vibe Cli](https://github.com/mattpocock/sandcastle/issues/1607).
Decided via the wayfinder map at `plans/vibe-agent-provider/map.md` — all 12 tickets closed; each decision below cites its ticket. Research evidence: `research/vibe-*.md` (all claims sourced to primary sources and sanitized empirical runs of vibe 3.0.4).

## Problem Statement

Sandcastle ships agent providers for Claude Code, Codex, Pi, Copilot, Cursor and OpenCode, but not for the Mistral Vibe CLI. A Vibe user cannot point `run()` at `vibe()` — there is no factory, no stream parser, no session capture/resume, and `sandcastle init` does not offer it — so they cannot use Sandcastle with the agent they already run daily.

## Solution

Add a built-in `vibe()` agent provider (Mistral Vibe CLI, verified against vibe 3.0.4):

- **Print mode:** `vibe -p --output streaming --model '<model>' [--auto-approve] [--resume '<id>']` with the prompt piped on **stdin** (bare `-p` reads stdin). `--auto-approve` is passed exactly when Sandcastle's `dangerouslySkipPermissions` is set, because headless vibe otherwise denies approval-needing tool calls while still exiting 0.
- **Streaming display:** `--output streaming` emits one whole history entry per NDJSON line; the provider's `parseStreamLine` maps entries to `ParsedStreamEvent`s (text, result, tool_call, session_id, error).
- **Sessions:** capture the whole unified session dir `$VIBE_HOME/logs/session/unified/<id>/` from sandbox to a host store mirroring vibe's own layout (`~/.vibe/logs/session/unified/<id>/`), rewriting only the cwd fields in `meta.json`; resume via `--resume <id>` after copying the dir back. Fork is unsupported (`canFork: false`, `ForkNotSupportedError`) — vibe has no `-p`-mode fork.
- **Usage & context window:** sourced from the captured session journal's last `usage` line (codex-style bucket mapping); not available on the stream.
- **Scaffold:** `AGENT_REGISTRY` entry (`vibe` / "Mistral Vibe" / default model `mistral-medium-3.5`) and a `VIBE_DOCKERFILE` installing via uv; `envExample` documents `MISTRAL_API_KEY`.
- **Surface:** `vibe` + `VibeOptions` exported from the package entry point; `docs/guide` provider/session pages updated; minor changeset.

## User Stories

1. As a Sandcastle user, I want to call `run({ agent: vibe("mistral-medium-3.5"), sandbox: docker(), prompt: "…" })`, so that a Mistral Vibe CLI agent works in a sandbox exactly like the existing providers.
2. As a user, I want the prompt delivered on stdin rather than argv, so that large prompts (well past the ~128 KB argv limit) work without special handling.
3. As a user watching a run, I want live assistant text and tool-call display, so that long iterations are legible as they happen.
4. As a user, I want the run to fail loudly on auth/config errors (bad `MISTRAL_API_KEY`, unknown model), so that I am not misled by an exit-0 run that did nothing.
5. As a user, I want AFK runs to auto-approve tool calls via `--auto-approve`, so that the agent is not silently blocked by approval prompts in a headless sandbox.
6. As a user, I want Sandcastle to capture the vibe session after each iteration, so that I can inspect it and resume it later.
7. As a user, I want `result.resume?.("follow-up")` to continue a captured vibe session in a new sandbox, so that multi-iteration workflows (plan → implement → review) work with vibe like the other providers.
8. As a user, I want resume to work across sandboxes even though vibe re-roots a resumed session into its recorded working directory, so that the captured session's cwd is rewritten to match each environment.
9. As a user, I want `result.resume?.()` with fork to fail fast with `ForkNotSupportedError` before any sandbox starts, so that I learn vibe cannot fork rather than getting a silently mutated parent session.
10. As a user, I want the token usage and context-window figures displayed per iteration, so that I can watch cost and context growth during long runs.
11. As a user, I want to opt out of session capture with `captureSessions: false`, so that I can run vibe without writing session state to the host.
12. As a user running `sandcastle init`, I want "Mistral Vibe" offered as an agent choice with a default model, an env example for `MISTRAL_API_KEY`, and a generated Dockerfile, so that a fresh project is runnable end to end.
13. As a user building the sandbox image, I want the Dockerfile to install vibe reproducibly on a Debian base (via uv, since the PyPI package needs Python ≥ 3.12 and there is no npm package), so that `sandcastle docker build-image` just works.
14. As a host user, I want init to detect a missing host `vibe` CLI and print the install hint (`uv tool install mistral-vibe`), so that interactive runs work too.
15. As a user resuming on the host (no-sandbox provider), I want the resume precheck to find my in-place vibe session by id, so that `sandbox: none()` + `resumeSession` works.
16. As a reader of the docs, I want the agent-providers and agent-sessions guide pages to list vibe alongside the other providers (options table, storage path, resume/fork table), so that the feature is discoverable and consistent.
17. As a maintainer, I want a changeset so the release notes mention the new provider, so that users upgrading see it.
18. As a maintainer, I want tests covering the command forms, stream parsing, usage/context-window parsing, cwd rewrite, and storage round-trip, so that regressions are caught without a live API key.

## Implementation Decisions

All decisions were locked in wayfinder tickets (see the map); the decision-rich summary:

- **Provider factory & options (ticket 06).** `vibe(model, options?)` returns an `AgentProvider` named `"vibe"`. `VibeOptions` is minimal and matches the other providers: `env?`, `captureSessions?` (default `true`), `sessionStorage?: { hostSessionsDir?, sandboxSessionsDir? }`. Extra vibe CLI knobs (`--max-turns`, `--max-price`, `--agent`, …) are deliberately not exposed — Sandcastle orchestrates iterations and timeouts itself. The provider injects `VIBE_ENABLE_TELEMETRY=false` and `VIBE_ENABLE_UPDATE_CHECKS=false` by default; `MISTRAL_API_KEY` remains the caller's env; `VIBE_HOME` stays at its default.
- **Print command (ticket 06).** Fresh AFK run: `vibe -p --output streaming --model '<model>' --auto-approve` with `{ stdin: prompt }`. Without skip-permissions, `--auto-approve` is omitted. `resumeSession` appends `--resume '<id>'`. `resumeSession` + `forkSession` throws `ForkNotSupportedError`. All interpolations shell-escaped with the existing `shellEscape` helper. `buildInteractiveArgs` returns the TUI argv (`vibe --model <model>`, optional positional prompt).
- **Stream parsing (ticket 07).** `--output streaming` NDJSON, one whole camelCase history entry per line. Mapping: `session_id` ← any entry's `sessionId`; assistant `message` entries → `text` + `result` (text blocks joined, `discarded` outcomes skipped); `effect` entries → `tool_call` for the shared tool allowlist only, with the `file_system.` harness prefix stripped and case-insensitive matching (bash→Bash/`input.command`, web_search→WebSearch/`input.query`, web_fetch→WebFetch/`input.url`, subagent→Agent, skill→Skill; fallback `display.summary`); `notice` with `level=="error"` and `effect` with `state.status=="failed"` → `error`. Defensive parsing (try/catch, unknown types → `[]`). No `usage`/`context_window` from the stream.
- **Usage & context window (ticket 08).** `parseSessionUsage` and `parseSessionContextWindow` read the captured session's concatenated journal JSONL and take the **last** line carrying a `usage` object. Usage maps codex-style: `input = input_tokens − cached_input_tokens`, `cacheRead = cached_input_tokens`, `cacheCreation = cache_write_tokens`, `output = output_tokens`. Context window = `{ tokens: input_tokens }` of that last call (per ADR 0023: one model call, cache included, never summed; no `limit`). Both are capture-gated (`captureSessions: false` → neither, and no resume).
- **Session storage (ticket 09).** Dir-based custom `AgentSessionStorage` (the file-based helper does not fit a directory tree). Sandbox side: `$VIBE_HOME/logs/session/unified/<id>/` under the sandbox home (overridable). Host side: `~/.vibe/logs/session/unified/<id>/` (overridable) — id-derivable paths, cwd ignored, and host-side `vibe --resume` works on captured sessions. Capture/resume move the **whole** session dir (journal references content-addressed chunks; partial copies corrupt resume) file-by-file via the sandbox handle's exec+copy primitives; child subagent dirs are not captured. cwd rewrite touches only `meta.json` (`environment.working_directory`, `origin_directory`) via a new pure string function `transferVibeMetaJson(content, fromCwd, toCwd)` alongside the existing transfer helpers. `readHostSession` returns the journal files concatenated in sequence order; `findByIdOnHost` matches the `<root>/<id>` dir first, then scans subdirs' `meta.json` `session_id`; `hostSessionFilePath` returns the session dir; `existsOnHost` checks the dir.
- **Resume & fork (ticket 10).** `canFork: false` on the storage + the fork throw in the command builder (ADR 0021 pattern). The existing resume precheck works unchanged for sandbox and no-sandbox runs because vibe's lookups are id-derivable. End-to-end: precheck → `resumeIntoSandbox` (host→sandbox cwd rewrite) → `--resume <id>` → vibe re-roots to the recorded working directory → `captureToHost` (sandbox→host rewrite).
- **Init scaffold (ticket 11).** Registry entry `{ name: "vibe", label: "Mistral Vibe", defaultModel: "mistral-medium-3.5", factoryImport: "vibe" }`; `VIBE_DOCKERFILE` keeps the shared template skeleton (system deps, issue-tracker-tools placeholder, UID/GID alignment, `USER agent`, entrypoint) with install `curl -LsSf https://astral.sh/uv/0.11.26/install.sh | sh && uv tool install mistral-vibe` as the agent user (uv's managed CPython is required: PyPI needs Python ≥ 3.12, bookworm ships 3.11, no npm package exists; package left unpinned like every other template — the image build is the pin). `envExample` documents `MISTRAL_API_KEY`; `setupCommand` uses the interactive positional-prompt form; `hostCli` = `{ command: "vibe", install: "uv tool install mistral-vibe" }`.
- **Exports, docs, changeset (ticket 12).** Export `vibe` and `VibeOptions` from the package entry point (the meta.json transfer helper stays internal, matching the pi/copilot precedent). Docs: provider intro list + a `VibeOptions` options table in the agent-providers guide page; storage path, capture-default list, resume list and resume/fork table row (`vibe --resume <id>`; fork throws) in the agent-sessions page; README unchanged. Changeset: `minor` for `@ai-hero/sandcastle` (new feature, pre-1.0).

## Testing Decisions

- Prior art: per-factory `describe` blocks in the existing agent-provider test module; session-storage round-trip tests use a fake sandbox handle; transfer helpers are tested as pure string functions. Tests must run without a live API key — stream fixtures come from the committed sanitized captures (`research/vibe-p-output-schema.md` §5, `research/vibe-roundtrip/run1.out`).
- Coverage: `buildPrintCommand` fresh / without skip-permissions / resume forms (stdin prompt, flag composition, fork throw); `buildInteractiveArgs`; `parseStreamLine` (session_id, text+result, discarded outcomes, tool_call mapping incl. prefix stripping and summary fallback, error events, non-JSON/unknown lines); `parseSessionUsage`/`parseSessionContextWindow` (last usage line wins, bucket mapping); `transferVibeMetaJson` rewrites; `sessionStorage` round-trip (capture host↔sandbox with cwd rewrite both directions, `existsOnHost`, `hostSessionFilePath`, `readHostSession` journal ordering, `findByIdOnHost` fallbacks); the `captureSessions` opt-out.
- Docs tests: the docs-guide test enforces glossary-term linking rules on the touched guide pages.
- Per repo policy: `npm run typecheck`, `npm test`, and the `verify` skill on the agent × sandbox combination this touches, before finishing.

## Out of Scope

- ACP / app-server / programmatic-SDK use of Vibe — CLI only.
- Vibe Code Web, `/teleport`, remote projects, voice features.
- Non-Mistral providers, custom agents, plugins, or MCP servers inside the sandboxed vibe; Sandcastle passes `MISTRAL_API_KEY` only.
- Fork support for vibe (no `-p`-mode fork exists; `canFork: false`).
- Capturing child/subagent session dirs (may graduate later, like Claude's best-effort subagent capture).
- Exposing extra vibe CLI knobs as provider options.
- Changing the Vibe CLI itself — upstream gaps are filed upstream.

## Further Notes

- Session-ID round-trip was verified empirically on vibe 3.0.4 before any design: `--resume` accepts the full UUID or its first 8 chars, continues in place, and works from any cwd (re-roots to the recorded working directory — bind-mount sandboxes mount the worktree at the same path, so this composes).
- Exit-code taxonomy (0 finished / 1 usage-config incl. auth / 2 infrastructure / 3 limits / 4 abort) is handled by the existing orchestrator exit-code path; only in-stream failures map to `error` events.
- Publishing the wayfinder map and these tickets to the GitHub tracker requires a writable credential; this session's App token is read-only, so `plans/vibe-agent-provider/publish-to-tracker.sh` generates the `gh` commands to file them (map issue + child tickets + this spec as a `ready-for-agent` issue).
