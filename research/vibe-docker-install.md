# Installing mistral-vibe in the sandbox image: uv vs pip, headless viability, VIBE_HOME

Research for ticket `plans/vibe-agent-provider/tickets/04-vibe-docker-install.md` (wayfinder map: `plans/vibe-agent-provider/map.md`).

**Date:** 2026-11-07. **Vibe version tested:** 3.0.4 (installed at `/nix/store/yv9apsfc489whxasi5vjvdm42kdpgmlf-mistral-vibe-3.0.4`, readable as source; cited below as `vibe-src`).

## Sources (primary only)

- [PyPI JSON API, `mistral-vibe`](https://pypi.org/pypi/mistral-vibe/json) and [PyPI project page](https://pypi.org/project/mistral-vibe/)
- [mistral-vibe GitHub README, install section](https://github.com/mistralai/mistral-vibe#readme)
- [Mistral's official install script](https://mistral.ai/vibe/install.sh) (`curl -LsSf https://mistral.ai/vibe/install.sh`)
- [uv docs: tools](https://docs.astral.sh/uv/concepts/tools/) and [uv docs: environment variables](https://docs.astral.sh/uv/reference/environment/)
- [npm registry search for `mistral-vibe`](https://registry.npmjs.org/-/v1/search?text=mistral-vibe)
- [Debian bookworm `python3` package](https://packages.debian.org/bookworm/python3) and [`libc6`](https://packages.debian.org/bookworm/amd64/libc6)
- `vibe-src` = vibe 3.0.4 site-packages source (`.../site-packages/vibe/...`), with file:line refs
- `vibe --help` / `vibe -p --help` output of vibe 3.0.4 on this host
- Empirical runs of `vibe -p` (commands and results below; all run with `MISTRAL_API_KEY` already in the environment, scratch `VIBE_HOME`, output sanitized)
- `src/InitService.ts` in this repo (existing `*_DOCKERFILE` templates)

## 1. Install route: `uv tool install mistral-vibe` (recommended)

Facts that decide the route:

- The package on PyPI is `mistral-vibe` with **`Requires-Python: >=3.12`** [PyPI JSON API]. Wheels are `cp312-abi3` (abi3, so any CPython >= 3.12 works): `manylinux_2_28_{x86_64,aarch64}`, `macosx_11_0_*`, `win_amd64`, plus an sdist; the manylinux x86_64 wheel of 3.1.0 is ~71 MB [PyPI JSON API, release files]. The `manylinux_2_28` tag means it needs only glibc >= 2.28 from the system; bookworm ships glibc 2.36 [Debian bookworm libc6], so the wheel runs on `node:22-bookworm` unmodified.
- Debian bookworm's apt `python3` is **3.11.2** [Debian bookworm python3] — below `>=3.12`, so `apt install python3 && pip install mistral-vibe` on bookworm cannot work (pip will refuse: no compatible release). `pipx` has the same problem: it needs a Python >= 3.12 interpreter to build the tool venv with, which bookworm doesn't provide. Installing a newer Python another way (deadsnakes is Ubuntu-only; building from source is slow) all adds more than uv does.
- **There is no official npm package.** npm search for `mistral-vibe` returns only third-party wrappers/adapters [npm search]. The README's install section lists exactly three routes: `curl -LsSf https://mistral.ai/vibe/install.sh | bash`, `uv tool install mistral-vibe`, `pip install mistral-vibe` [GitHub README]. The npm-based pattern used by the other `*_DOCKERFILE` templates therefore doesn't apply to vibe.
- `uv tool install` brings its **own managed CPython**, so the image's Python version is irrelevant — this is the key advantage on bookworm. uv docs: `uv tool install` creates an isolated venv in the uv tools dir and puts the executable on PATH via the tool bin directory; version specifiers like `{package}@{version}` / `{package}@latest` are respected [uv tools docs]. The executable directory defaults to `~/.local/bin` on Linux and can be overridden with `UV_TOOL_BIN_DIR` [uv env docs]; Mistral's own install script adds `$HOME/.local/bin` to PATH after installing uv [install.sh].
- Mistral's install script installs uv itself via the Astral installer pinned to a version + SHA-256 (`UV_INSTALLER_VERSION="0.11.26"`, checksum verified before running), then runs `uv tool install --python cpython-3.14+gil mistral-vibe` (seeding `uv python install cpython-3.14` first) [install.sh]. The README notes vibe needs a **GIL-enabled** Python 3.12+; on a fresh container uv's managed CPython is a GIL build by default, but if a free-threaded interpreter is ever selected the fallback is `uv python install cpython-3.14 && uv tool install --python cpython-3.14+gil mistral-vibe` [GitHub README; install.sh].
- The wheel bundles the Rust CLI (`vibe/_bin/vibe-rs`); the `vibe` console script is a tiny Python launcher that execs it with `vibe-app-server` as backend (`vibe-src/cli/launcher.py:13-40,68-79`; entry points in `mistral_vibe-3.0.4.dist-info/entry_points.txt`: `vibe=vibe.cli.launcher:main`). So one `uv tool install` yields both `vibe` and `vibe-app-server` on PATH.

**Recommendation:** install uv via the Astral installer (version-pinned URL, mirroring how `install.sh` pins it), then `uv tool install mistral-vibe` as the `agent` user — both land in `/home/agent/.local/bin`, which is exactly the `ENV PATH="/home/agent/.local/bin:$PATH"` line the `CLAUDE_CODE_DOCKERFILE` template already uses. This is the smallest single route (one ~5 MB uv binary + one ~71 MB wheel + one managed CPython) and the only route that doesn't require replacing bookworm's Python.

**Version pinning — mirror the existing templates:** none of the `*_DOCKERFILE` constants in `src/InitService.ts` pin a package version; they install latest at image-build time (`npm install -g @openai/codex`, `@earendil-works/pi-coding-agent`, `@github/copilot` bare; `opencode-ai@latest` explicit; claude/cursor via unpinned `curl | bash` installers), so the built image is the pin point. Mirror that: bare `uv tool install mistral-vibe`. If a hard pin is ever wanted, uv accepts `uv tool install mistral-vibe@3.0.4` [uv tools docs]. Optionally pin the uv installer itself via `https://astral.sh/uv/0.11.26/install.sh` (the version Mistral's own script pins) [install.sh].

### Diff-ready Dockerfile block (shaped on `CLAUDE_CODE_DOCKERFILE`, `src/InitService.ts:240`)

```dockerfile
FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \\
  git \\
  curl \\
  jq \\
  && rm -rf /var/lib/apt/lists/*

{{ISSUE_TRACKER_TOOLS}}

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -o -g $AGENT_GID node && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node
USER \${AGENT_UID}:\${AGENT_GID}

# Install uv (Astral installer, version pinned like https://mistral.ai/vibe/install.sh),
# then the Vibe CLI as a uv tool. uv ships a managed CPython >= 3.12, so the image's
# python3.11 is irrelevant; mistral-vibe requires Python >= 3.12 (PyPI).
# Latest-at-build-time, matching the other templates (npm installs are unpinned too).
RUN curl -LsSf https://astral.sh/uv/0.11.26/install.sh | sh \\
  && uv tool install mistral-vibe

# uv and uv-installed tools (vibe, vibe-app-server) both live in ~/.local/bin
ENV PATH="/home/agent/.local/bin:$PATH"

WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at ${SANDBOX_REPO_DIR}
# and overrides the working directory to ${SANDBOX_REPO_DIR} at container start.
# Structure your Dockerfile so that ${SANDBOX_REPO_DIR} can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
```

(Equivalent one-liner, less transparent in a Dockerfile: `curl -LsSf https://mistral.ai/vibe/install.sh | bash` — it installs uv with a SHA-256-pinned installer and then runs the same `uv tool install` [install.sh].)

## 2. Headless (`vibe -p`) environment requirements

Empirical, vibe 3.0.4 on this host (all with `MISTRAL_API_KEY` in env, stdin `</dev/null`, no controlling terminal — this shell has no TTY):

| Run | Command shape | Result |
|---|---|---|
| Normal env, scratch `VIBE_HOME` | `VIBE_HOME=/tmp/vibe-scratch1 vibe -p "Reply ... PONG" --output text --max-turns 2 </dev/null` | exit 0, stdout exactly `PONG`, empty stderr |
| Minimal env: `env -i PATH=<vibe bin dir + sh/timeout only> HOME=/tmp/fakehome VIBE_HOME=... MISTRAL_API_KEY=...` — **no TERM, no git on PATH** | same `-p` run | exit 0, stdout `PONG2`; verified `git NOT on PATH`, no TTY |
| Resume | `VIBE_HOME=/tmp/vibe-scratch1 vibe -p "... PONG3" --resume d015fa3a-... --output text` | exit 0, stdout `PONG3`, same session dir reused |

Conclusions:

- **No TTY and no TERM are needed for `-p`.** `-p/--prompt` is the documented headless mode: "Run in headless (programmatic) mode: send prompt, output response, exit" (`vibe --help`, v3.0.4). It ran cleanly with stdin from `/dev/null` and no terminal. (`-p` with no value reads the prompt from stdin — piping or `--prompt-file` works too; `vibe --help`.)
- **git is not required for a basic `-p` run** — it succeeded with git absent from PATH. Source: GitPython resolves the git executable at import time and raises when missing, but it is imported lazily, "only the git operations themselves may need it" (`vibe-src/core/git/repo.py:13-16`). Keep `git` in the apt list anyway (all existing templates do): Sandcastle runs vibe inside git worktrees, and worktree/checkpoint/git-tool operations need the binary.
- Output formats for headless: `--output text|json|streaming` (default `text`); `--max-turns`, `--max-price`, `--time-limit`, `--output-dir` (writes `export.json` + a copy of the session journal on every exit) are all headless flags (`vibe --help`, v3.0.4).

## 3. VIBE_HOME and session capture

- `VIBE_HOME` env var overrides the default `~/.vibe` (`vibe-src/utils/vibe_home.py:8-13`: `os.getenv("VIBE_HOME")` else `Path.home()/".vibe"`). With the image's `agent` user (home `/home/agent`), the default is `/home/agent/.vibe` — no override needed unless we want one.
- Derived paths (`vibe-src/core/paths/_vibe_home.py:13-37`): `.env`, `logs/session` (=`SESSION_LOG_DIR`), `logs/vibe.log`, `worktrees/`, `trusted_folders.toml`, `cache.toml`, `projects.toml`, `vibehistory`, etc. Startup creates `VIBE_HOME` with mode `0700` and seeds `vibehistory` (`restrict_vibe_home_permissions` / `bootstrap_vibe_home`, `_vibe_home.py:40-77`).
- **What a first `-p` run creates** (empirical tree under scratch `VIBE_HOME`): `vibehistory`, `logs/vibe.log`-area dirs, and session data under `logs/session/` — in 3.0.4 the per-session layout is `logs/session/unified/<session-uuid>/{meta.json, journal/*.jsonl, generations/*/…, chunks/*.json, scheduled-loops.json}`, plus `logs/session/active/.registry` and `logs/session/plugins/…`, and cache files at the root (`connector_bootstrap_cache.json`, `managed_config_cache.json`, `whoami_cache.json`, `experiment_eval_cache.json`). `meta.json` holds `session_id`, `start_time`/`end_time`, `working_directory`, `child_sessions`, `config.active_model`, etc. (empirical, key redacted).
- **Pointing session capture somewhere predictable:** either set `VIBE_HOME` to a fixed path (e.g. `ENV VIBE_HOME=/home/agent/.vibe` explicitly, or a data dir), or set `session_logging.save_dir` in the global config `$VIBE_HOME/config.toml` (`vibe-src/core/config/layers/user.py:26` — user config path is `VIBE_HOME/config.toml`; `SessionLoggingConfig.save_dir` defaults to `SESSION_LOG_DIR` and is expanduser/resolve-expanded, `vibe-src/core/config/models.py:108-133`; schema via `vibe config schema`, v3.0.4). Sessions are plain files under that dir, so any bind-mounted volume works for capture. `--resume <session-id>` works headless against them (empirical PONG3 run above), and `--output-dir DIR` additionally writes `export.json` + a session copy on every exit (`vibe --help`).

## 4. Headless auth: `MISTRAL_API_KEY` in the env is sufficient

- The default provider config uses `api_key_env_var = "MISTRAL_API_KEY"` (`DEFAULT_MISTRAL_API_ENV_KEY`, `vibe-src/core/config/vibe_schema.py` `DEFAULT_PROVIDERS` / `_defaults.py:9`).
- Key resolution order is session credentials → **process environment** → keyring → OIDC (`vibe-src/utils/api_keys.py`, `ApiKeySource` and `resolve_api_key_with_origin`: `os.environ.get(env_key)` before keyring). So a `MISTRAL_API_KEY` env var needs no browser sign-in and no `~/.vibe/.env`.
- `$VIBE_HOME/.env` is loaded as a dotenv fallback, but an explicit non-empty process env value **wins** over the .env file (`load_dotenv_values`, `vibe-src/core/config/vibe_schema.py:150-170`: "An explicit non-empty process/shell value wins over the .env file").
- Empirical: both headless runs above succeeded with `MISTRAL_API_KEY` only in the environment and a `HOME` containing no `.vibe/.env` — no interactive setup (`vibe --setup` exists for the browser/console flow, `vibe --help`). For the sandbox, Sandcastle passing `MISTRAL_API_KEY` through the env is all that's required.

## 5. Answers to the ticket's questions (summary)

1. **Install route:** `uv tool install mistral-vibe` after installing uv via the Astral installer — smallest and only route that works on bookworm without replacing its Python (`Requires-Python >= 3.12` vs bookworm `python3` 3.11.2). No npm package exists. `pip install mistral-vibe` and `pipx` both need a >= 3.12 interpreter bookworm doesn't ship.
2. **Headless needs:** no TTY, no TERM (empirically verified with `env -i`, stdin `/dev/null`); git not needed for a plain `-p` run but keep it for worktree/git operations.
3. **VIBE_HOME:** env-overridable, defaults to `/home/agent/.vibe` under the image's `agent` user; first `-p` run creates `logs/session/unified/<uuid>/…` (+ caches); redirect with `VIBE_HOME` or `session_logging.save_dir` in `$VIBE_HOME/config.toml`; `--resume <id>` works headless.
4. **Auth:** `MISTRAL_API_KEY` env var alone suffices for `-p`; env wins over `$VIBE_HOME/.env`; no browser sign-in.
5. **Pinning:** mirror the other templates — install latest at image-build time (bare `uv tool install mistral-vibe`; optionally `mistral-vibe@<version>`); the built image is the pin. Pin the uv installer URL (`astral.sh/uv/0.11.26/install.sh`) as Mistral's script does.
