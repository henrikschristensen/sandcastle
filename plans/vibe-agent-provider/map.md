# Wayfinder map: support Mistral Vibe CLI as a built-in agent provider

**Tracker:** local-markdown fallback — the GitHub App token in this session is read-only (403 on issue writes), so per the wayfinder skill the map and its tickets live in this directory: `map.md` plus `tickets/*.md`. Frontier query: list `tickets/`, keep `state: open`, drop any whose `blocked_by` slugs are not all `state: closed`. Claim a ticket by setting `assignee` before working. Originating request: [Support Mistral Vibe Cli](https://github.com/mattpocock/sandcastle/issues/1607).

## Destination

A fully decided implementation spec for supporting the **Mistral Vibe CLI** as a built-in **agent provider** in Sandcastle: a `vibe()` factory in `src/AgentProvider.ts` with print command + JSON stream parsing + provider-owned session storage for resume, tests in `src/AgentProvider.test.ts`, public export from `src/index.ts`, an `AGENT_REGISTRY` entry + `VIBE_DOCKERFILE` for `sandcastle init`, `docs/guide/` updates, and a changeset — per `docs/agents/adding-an-agent-provider.md`. The map is done when every ticket is closed: nothing left to decide before someone implements.

## Notes

- **Domain:** Sandcastle = TS library orchestrating AI coding agents in isolated sandboxes. Agent providers live in `src/AgentProvider.ts` — `claudeCode`, `codex`, `pi`, `cursor`, `opencode`, `copilot` are the patterns to follow. Session transfer helpers live in `src/SessionStore.ts` (incl. the reusable `makeSessionFileStorage`).
- **Skills:** decision (grilling) tickets consult `/grilling` + `/domain-modeling`; research tickets are resolved by `/research` subagents.
- **Source materials:**
  - `docs/agents/adding-an-agent-provider.md` — must-have CLI capabilities, the `AgentProvider` interface, the implementation checklist.
  - ADRs 0012 (provider-owned session storage), 0016 (resume requires filesystem-backed sessions), 0018 (fork is session-only), 0021 (resume without fork), 0022 (export/import resume), 0023 (context window = last model call) in `docs/adr/`.
  - The `vibe:vibe` skill documents the Vibe 3.0.4 CLI surface: `-p/--prompt`, `--output text|json|streaming`, `--auto-approve/--yolo`, `--model`, `--resume <id>`, `-c`, sessions under `~/.vibe/logs/session/<dir>/{messages.jsonl,meta.json}`.
  - Local install on this host: `vibe 3.0.4` (nix store site-packages readable as source); `MISTRAL_API_KEY` is present in the environment, so empirical runs are possible — never read or print `~/.vibe/.env` or the key.
- **Scope decisions locked while charting (grilled with the user):** full built-in provider including init scaffold + Dockerfile + docs + changeset (the checklist is the destination); resume is required (ADR 0012), not optional; plan-only — this map produces decisions and hands implementation off; naming/defaults follow repo conventions (`vibe()` factory, `name: "vibe"`, `MISTRAL_API_KEY` auth).

## Decisions so far

<!-- one line per closed ticket: gist of the answer + link to the ticket -->

- [What events do vibe -p --output json and --output streaming emit?](tickets/01-vibe-p-output-schema.md) — In 3.0.4 all `-p` output modes print app-server **history entries**: `--output streaming` is live NDJSON (one whole entry per line), `json` is the whole-session array printed at end. Tool calls are `effect` entries (`detail.toolName`, displayable arg in `detail.input.command` or `detail.display.summary`); `session_id` rides every entry's `sessionId`; there are **no usage / context-window events on stdout** (they live in `--output-dir`'s `export.json`); errors go to stderr with exit codes 0–4 plus in-stream `notice`/`failed` entries. Findings: `research/vibe-p-output-schema.md`.
- [Vibe print-mode CLI surface: prompt input, flags, exit codes](tickets/02-vibe-cli-surface.md) — `-p` with no value reads the prompt from **stdin** (byte-capped); `--resume` in `-p` requires an explicit id; **no fork flag** (fork is in-session `/branch` only); `--model` takes a config alias; headless runs must pass `--auto-approve` (otherwise tool calls are denied while still exiting 0); exit codes: 0 finished, 1 usage/config (incl. bad `MISTRAL_API_KEY`), 2 infra, 3 limits, 4 abort; headless env: `VIBE_HOME`, `MISTRAL_API_KEY`, `VIBE_ENABLE_TELEMETRY=false`, `VIBE_ENABLE_UPDATE_CHECKS=false`. Findings: `research/vibe-cli-surface.md`.
- [Vibe session storage: on-disk layout, transcript format, cwd, session-id semantics](tickets/03-vibe-session-storage.md) — 3.0.4 writes only the **unified store** `$VIBE_HOME/logs/session/unified/<uuid>/` (`meta.json` + hash-chained `journal/*.jsonl`); legacy `messages.jsonl` dirs are read-only and imported on resume. cwd lives only in `meta.json.environment.working_directory`; `--resume` accepts the full UUID or its first 8 chars, resolves globally, and re-roots into the recorded working directory (resume needs the workspace at the same absolute path). `--output-dir DIR` is the clean capture hook: it writes `export.json` (session_id, usage, cost) plus a full copy of the session dir; child sessions sit in sibling `child-<hex>` dirs. Findings: `research/vibe-session-storage.md`.
- [Installing mistral-vibe in the sandbox image: uv vs pip, headless viability, VIBE_HOME](tickets/04-vibe-docker-install.md) — Install via **uv** (`curl -LsSf https://astral.sh/uv/…/install.sh | sh && uv tool install mistral-vibe` as the `agent` user; PyPI needs Python ≥ 3.12 but bookworm's apt python is 3.11, and no npm package exists). Headless `vibe -p` verified with no TTY/TERM/git; `MISTRAL_API_KEY` in the env alone suffices; `VIBE_HOME` is env-overridable. Findings: `research/vibe-docker-install.md`.
- [Empirical check: vibe -p session-id round-trip, captured stream, exit codes](tickets/05-vibe-roundtrip-empirical.md) — **Round-trip verified on 3.0.4**: streamed `sessionId` == unified dir == `meta.json.session_id`; `--resume` takes the full UUID or its first 8 chars, continues in place, and re-roots into the recorded `working_directory` (same absolute path required). Exit codes: 0 ok, 1 usage/config incl. bad key/unknown model (stderr only), 2 infra, 3 limits, 4 abort. **No `-p`-mode fork** → `canFork: false`. `--output-dir DIR` exports `export.json` (session_id, usage, cost, outcome) + a full session-dir copy on every exit — the capture hook; usage/context-window are not on stdout. Samples: `research/vibe-roundtrip/`.

- [The vibe print command: exact invocation, prompt delivery, flags, env defaults](tickets/06-vibe-print-command.md) — Locked via grilling: `vibe -p --output streaming --model '<model>' [--auto-approve] [--resume '<id>']` with the **prompt on stdin** (`{ command, stdin }`); `--auto-approve` iff `dangerouslySkipPermissions`; resume appends `--resume <id>`, fork throws `ForkNotSupportedError`; provider env = `VIBE_ENABLE_TELEMETRY=false` + `VIBE_ENABLE_UPDATE_CHECKS=false`; no `--output-dir`; `VibeOptions` minimal (`env`, `captureSessions`, `sessionStorage` dirs).
- [Stream parsing map: vibe events to ParsedStreamEvent and tool display](tickets/07-vibe-stream-parsing.md) — Locked via grilling: `session_id` ← any entry's `sessionId`; assistant `message` → `text`+`result` (blocks joined `"\n\n"`, discarded outcomes skipped); `effect` → `tool_call` for the shared allowlist only, `file_system.`-prefix stripped, case-insensitive match (bash→Bash/`input.command`, web_search→WebSearch/`query`, web_fetch→WebFetch/`url`, subagent→Agent, skill→Skill; fallback `display.summary`); `notice level=="error"` and `failed` effects → `error`; no `usage`/`context_window` from the stream; defensive parsing, emit on arrival.

## Not yet specified

<!-- in-scope fog; graduates as the frontier advances -->

- `buildInteractiveArgs` form for the vibe TUI (ticket 06 sketched `["vibe", "--model", model]` + optional positional prompt; refine at implementation).
- How the sandboxed vibe receives issue-tracker tools — the `{{ISSUE_TRACKER_TOOLS}}` Dockerfile placeholder mechanics (graduates with the init-scaffold ticket).
- Whether session capture must include child/subagent session dirs (answered structurally by ticket 03: sibling `child-<hex>` dirs; the capture-scope decision belongs to ticket 09).

## Out of scope

<!-- ruled beyond the destination; never graduates -->

- ACP / app-server / programmatic SDK use of Vibe — CLI only.
- Vibe Code Web, `/teleport`, remote projects, voice features.
- Non-Mistral providers, custom agents, plugins, or MCP servers inside the sandboxed vibe; Sandcastle passes `MISTRAL_API_KEY` only.
- Changing the Vibe CLI itself (upstream gaps are filed upstream, not decided here).
