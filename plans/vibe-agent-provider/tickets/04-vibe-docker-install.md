---
title: "Installing mistral-vibe in the sandbox image: uv vs pip, headless viability, VIBE_HOME"
type: research
state: closed
assignee: henrikschristensen
blocked_by: []
---

## Question

How should `VIBE_DOCKERFILE` install the Vibe CLI reproducibly in a Debian-based image, given the existing templates in `src/InitService.ts` all start `FROM node:22-bookworm`?

- Install routes for `mistral-vibe` (PyPI): `pip install mistral-vibe` (bookworm has python3.11 — does the package support it?), `pipx`, or `uv tool install mistral-vibe` (needs a uv binary — apt? curl script?). Which is most reproducible and smallest? Is there an npm package?
- What else the image needs for `vibe -p` to run headless: git? a TTY (TERM)? Does `-p` work with no TTY at all?
- `VIBE_HOME` in the sandbox: default `~/.vibe` under the image's `agent` user — what gets created on first `-p` run, and can `session_logging.save_dir` / `VIBE_HOME` be pointed somewhere predictable for session capture?
- Auth headless: does `MISTRAL_API_KEY` in the env suffice for `-p` (no browser sign-in, no `~/.vibe/.env`)?
- Version pinning strategy used by other Dockerfiles in `InitService.ts` — mirror it.

## Sources (primary only)

- PyPI page for `mistral-vibe` (requires-python, wheels), uv docs, `vibe --help`.
- The installed 3.0.4 source for startup requirements (does it need git on PATH? a TTY?).
- Existing `*_DOCKERFILE` constants in `src/InitService.ts` as structural reference.

## Deliverable

Write findings to `research/vibe-docker-install.md`: a recommended Dockerfile install block (diff-ready against the `CLAUDE_CODE_DOCKERFILE` shape), with the install route chosen and why, plus headless-env requirements. Add a `## Findings` pointer to this ticket file and set `state: closed`.

## Findings

Full findings with primary-source citations: [`research/vibe-docker-install.md`](../../../research/vibe-docker-install.md).

Gist: install via **uv** — `curl -LsSf https://astral.sh/uv/0.11.26/install.sh | sh && uv tool install mistral-vibe` as the `agent` user (both land in `/home/agent/.local/bin`, covered by the template's existing `ENV PATH`). `mistral-vibe` on PyPI requires Python >= 3.12 and bookworm's apt python3 is 3.11.2, so pip/pipx on the system Python can't work and there is no npm package; uv ships a managed CPython so the image's Python is irrelevant, and the manylinux_2_28 wheel runs on bookworm's glibc 2.36. Pinning mirrors the other templates: latest at image-build time (bare `uv tool install mistral-vibe`; image build is the pin). Headless `-p` needs **no TTY and no TERM** and not even git on PATH for a plain run (all verified empirically with `env -i`, stdin `/dev/null`); keep `git` in apt for worktree/git-tool operations. `VIBE_HOME` (default `/home/agent/.vibe`) is env-overridable; first run writes sessions to `logs/session/unified/<uuid>/` and `session_logging.save_dir` in `$VIBE_HOME/config.toml` can redirect capture; `--resume <id>` works headless. `MISTRAL_API_KEY` in the env alone suffices for `-p` (env wins over `$VIBE_HOME/.env`; no browser sign-in).
