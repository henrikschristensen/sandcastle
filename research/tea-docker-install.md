# Installing a pinned `tea` (Gitea CLI) release in the Debian sandbox image: assets, checksums, static binary, candidate RUN block

Research for ticket `plans/tea-codeberg/tickets/02-tea-docker-install.md` (wayfinder map: `plans/tea-codeberg/map.md`).

**Date:** 2026-11-07. **tea version tested:** 0.16.0 (latest stable as of today; see §1).

## Sources (primary only)

- Gitea API for the canonical repo `gitea/tea`: `https://gitea.com/api/v1/repos/gitea/tea/releases?limit=10` and `.../releases/tags/v0.9.0` (release/tag/asset lists; run 2026-11-07)
- Release asset URLs: `https://gitea.com/gitea/tea/releases/download/v0.16.0/<asset>` and the R2 mirror `https://dl.gitea.com/tea/0.16.0/<asset>` (byte-identical, see §2)
- tea source at `https://gitea.com/gitea/tea` (raw `branch/master`): `.goreleaser.yaml`, `.goreleaser.checksum.sh`, `Makefile`, `README.md`
- tea README "Installation" section: `https://gitea.com/gitea/tea/raw/branch/master/README.md` lines 107–124
- docs.gitea.com: `https://docs.gitea.com/installation/install-from-binary/` and `.../install-from-package/` (server install docs; used to rule out an apt package for tea)
- Debian: `https://packages.debian.org/bookworm/amd64/libc6`, `https://packages.debian.org/bookworm/tea`, `https://sources.debian.org/api/src/glibc/`
- Empirical on this host (x86_64): downloaded `tea-0.16.0-linux-amd64.xz`, checksum-verified against `checksums.txt`, decompressed, `ldd`/`readelf`, ran `tea --version` (commands and output in §4)
- `src/InitService.ts` in this repo (the `BEADS_TOOLS` / `BEADS_VERSION` pattern at `src/InitService.ts:689-737`)

## 1. Repo, tags, latest stable version

- Canonical repo: **`gitea/tea` on gitea.com** (`https://gitea.com/gitea/tea`, Go module `gitea.dev/tea`). `https://code.gitea.io/tea` is a read-only mirror of it (its page header reads `code.gitea.io/tea git https://gitea.com/gitea/tea`).
- Release tags are **`vX.Y.Z`** (API `tag_name`: `v0.16.0`, `v0.15.1`, …, `v0.9.0`; no prereleases among the last 10 — all `prerelease: false`).
- **Latest stable as of 2026-11-07: `v0.16.0`**, published 2026-09-10 (`GET /api/v1/repos/gitea/tea/releases?limit=10`, first entry). `https://dl.gitea.com/tea/latest/` redirects to `/tea/0.16.0/`.
- Releases are built by **goreleaser** with `gitea_urls: download: https://gitea.com` and additionally published to a Cloudflare-R2 bucket that backs `dl.gitea.com` (`scripts/upload-r2.sh … tea/{{ .Version }}/{{ .ArtifactName }}` in `.goreleaser.yaml`).

## 2. Release asset names and URLs

For `v0.16.0` (32 assets, `GET /api/v1/repos/gitea/tea/releases?limit=1`), the linux assets are **bare binaries + xz-compressed copies + sha256 sidecars** — there is **no `.tar.gz`, no `.zip`**:

```
tea-0.16.0-linux-amd64        (bare ELF, 29,229,218 bytes)
tea-0.16.0-linux-amd64.xz     (6,647,460 bytes)
tea-0.16.0-linux-amd64.xz.sha256
tea-0.16.0-linux-arm64        (+ .xz, .xz.sha256)
tea-0.16.0-linux-arm-5/-6/-7 (+ .xz, .xz.sha256)
checksums.txt                 (sha256 of every asset, bare and .xz)
checksums.txt.sig             (GPG detached signature of checksums.txt)
```

Naming template comes from `.goreleaser.yaml` (`binary: {{ .ProjectName }}-{{ .Version }}-{{ .Os }}-{{ .Arch }}{{ if .Arm }}-{{ .Arm }}{{ end }}`, `archives: format: binary` — the "archive" is the bare binary — and a post hook `xz -k -9`). Same scheme since at least v0.9.0 (v0.9.0 assets: `tea-0.9.0-linux-amd64[.xz][.sha256][.asc]`, via `releases/tags/v0.9.0`). So the `tea_0.9.0_linux_amd64.tar.gz` guess is wrong: it has always been `tea-<ver>-linux-<arch>` with hyphens.

URLs that serve the assets (all verified by download on 2026-11-07):

- `https://gitea.com/gitea/tea/releases/download/v0.16.0/<asset>` — 303-redirects to the R2 attachment store; `curl -L` works.
- `https://dl.gitea.com/tea/0.16.0/<asset>` — 200 directly; `checksums.txt` there is **byte-identical** to the gitea.com one (`diff` clean), and `sha256sum` of the amd64 `.xz` from both hosts matches (`92e0c966…875149`). `https://dl.gitea.com/tea/latest/<asset>` works for unpinned installs.
- **`https://code.gitea.io/tea/releases/download/...` does not serve assets**: it 302s to `/tea/index.html` (checked with `curl -I` on 2026-11-07). Do not pin to code.gitea.io; use gitea.com or dl.gitea.com.

`dpkg --print-architecture` on the sandbox image returns `amd64`/`arm64`, which exactly match the asset arch suffixes (`linux-amd64`, `linux-arm64`); the 32-bit arm variants are `linux-arm-5/6/7`, so plain `armhf` would not map — irrelevant for our amd64/arm64 images.

## 3. Checksums asset and format

- Asset name: **`checksums.txt`** (goreleaser `checksum: name_template: 'checksums.txt'`), plus `checksums.txt.sig` (GPG detached sig, `signs:` block).
- Format is standard sha256sum: `<64-hex>␣␣<filename>` (two spaces), one line per asset, covering **both** the bare binary and its `.xz`. Real lines from `v0.16.0/checksums.txt`:

  ```
  9c142c8a0b31485eea2387031c1c404f12b7141075eb4ffbd7ced49441590636  tea-0.16.0-linux-amd64
  92e0c966c98be0c6ca4c80b1912d08ff7887c7cb55e123542fa541842d875149  tea-0.16.0-linux-amd64.xz
  ```

- Therefore the beads pattern works verbatim: `curl -fsSL "$URL/checksums.txt" | grep " ${ASSET}$" | sha256sum -c -`. Verified empirically for both the `.xz` and the bare binary (`…: OK`).
- Per-asset sidecar `tea-…-linux-amd64.xz.sha256` has the same `<hash>␣␣<name>` content (produced by `.goreleaser.checksum.sh`: `echo -n "${SUM}  ${BASENAME}"`); on gitea.com releases only the `.xz.sha256` sidecars are attached, the bare-binary `.sha256` exists on the dl.gitea.com mirror. `checksums.txt` is the single file to grep — prefer it.

## 4. Static vs dynamic; glibc; empirical verification

- `.goreleaser.yaml` builds with **`env: CGO_ENABLED=0`** and `-trimpath -s -w` → a **fully static** Go binary; no glibc or any other runtime library is required, so Debian bookworm's glibc **2.36** (`packages.debian.org/bookworm/amd64/libc6`; `sources.debian.org/api/src/glibc/` → `2.36-9+deb12u…`) is irrelevant. No runtime apt deps for tea itself.
- Empirical on this host (x86_64, 2026-11-07), all commands run in `/tmp/tea-research`:

  ```
  $ curl -fsSLO https://gitea.com/gitea/tea/releases/download/v0.16.0/tea-0.16.0-linux-amd64.xz
  $ curl -fsSL https://gitea.com/gitea/tea/releases/download/v0.16.0/checksums.txt | grep " tea-0.16.0-linux-amd64.xz$" | sha256sum -c -
  tea-0.16.0-linux-amd64.xz: OK
  $ xz -d tea-0.16.0-linux-amd64.xz
  $ ldd tea-0.16.0-linux-amd64
          not a dynamic executable
  $ readelf -d tea-0.16.0-linux-amd64
  There is no dynamic section in this file.
  $ grep " tea-0.16.0-linux-amd64$" checksums.txt | sha256sum -c -
  tea-0.16.0-linux-amd64: OK
  $ ./tea-0.16.0-linux-amd64 --version
  Version: 0.16.0  golang: 1.26.6  go-sdk: v1.2.0
  ```

  (ELF header `7f 45 4c 46 02 01 01 … 02 00 3e 00` = ELF64 LSB executable, x86-64.) So the binary runs anywhere, including bookworm, with zero apt-installed runtime deps — only `curl`+`ca-certificates` (already in `node:22-bookworm`) and `xz-utils` if the `.xz` asset is used.
- Note for the RUN sanity check: tea has **no `version` subcommand** (`tea version` → `No help topic for 'version'`, exit 3); use `tea --version` (prints `Version: 0.16.0  golang: 1.26.6  go-sdk: v1.2.0`). Unlike `bd version` in `BEADS_TOOLS`, don't write `tea version`.

## 5. apt / package-manager availability

- **No official apt package for tea.** tea's README "Installation" (`README.md:107-124`) lists: Homebrew on macOS (official), Arch/Alpine/MSYS2 packages (thirdparty), prebuilt binaries from `https://dl.gitea.com/tea/`, build from source, and the `gitea/tea` Docker Hub image. docs.gitea.com's "Installation from Package" covers only the **Gitea server** (`gitea`), not the tea CLI.
- **Debian name collision:** Debian bookworm does have a package named `tea`, but it is the _TEA graphical text editor_ ("graphical text editor with syntax highlighting", `packages.debian.org/bookworm/tea`) — **not** the Gitea CLI. `apt install tea` would install the wrong program.
- `packages.gitea.io` (the old Gitea-server apt host) does not resolve (DNS failure on 2026-11-07) and hosted only `gitea` anyway.
- Why the pinned binary release is still preferred: exact version pin via `ARG TEA_VERSION` (an apt/brew route can only do `latest` or distro-version), sha256 verification via `checksums.txt` before anything executes, no extra apt repo/trust (no third-party signing key), and one self-contained `RUN` — exactly the `BEADS_TOOLS` pattern.

## 6. Candidate Dockerfile block (mirrors `BEADS_TOOLS`, `src/InitService.ts:715-737`)

```dockerfile
# Pinned tea (Gitea CLI) release. Static binary (CGO_ENABLED=0), so no
# runtime apt dependencies beyond the download tools.
ARG TEA_VERSION=0.16.0
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    xz-utils \
  && rm -rf /var/lib/apt/lists/* \
  && ARCH=$(dpkg --print-architecture) \
  && TEA_ASSET="tea-${TEA_VERSION}-linux-${ARCH}.xz" \
  && TEA_URL="https://gitea.com/gitea/tea/releases/download/v${TEA_VERSION}" \
  && cd /tmp \
  && curl -fsSLO "${TEA_URL}/${TEA_ASSET}" \
  && curl -fsSL "${TEA_URL}/checksums.txt" | grep " ${TEA_ASSET}$" | sha256sum -c - \
  && xz -d "${TEA_ASSET}" \
  && install -m 0755 "${TEA_ASSET%.xz}" /usr/local/bin/tea \
  && rm "${TEA_ASSET}" "${TEA_ASSET%.xz}" \
  && tea --version
```

Notes:

- `TEA_VERSION` is the bare `0.16.0`; the tag is `v${TEA_VERSION}` and the asset is `tea-${TEA_VERSION}-linux-${ARCH}.xz` (hyphens, not underscores). `ARCH=$(dpkg --print-architecture)` yields `amd64`/`arm64`, matching the asset suffixes.
- Swap `TEA_URL` for `https://dl.gitea.com/tea/${TEA_VERSION}` (drop the `v`, R2 mirror, byte-identical assets and checksums) if gitea.com is unreachable; do not use `code.gitea.io/tea/releases/download/...` (302s to the repo index, §2). For an unpinned build, `https://dl.gitea.com/tea/latest/` resolves to the newest release.
- The grep pattern `" ${TEA_ASSET}$"` works because `checksums.txt` is `<sha256>␣␣<filename>` (§3) — same as the beads `checksums.txt` line at `src/InitService.ts:733`.
- Alternative without `xz-utils`: download the bare asset `tea-${TEA_VERSION}-linux-${ARCH}` instead of the `.xz` (29 MB vs 6.6 MB download; `checksums.txt` covers it too) and `install` it directly — one less apt package, same verification.
- Sanity-check line must be `tea --version` (there is no `tea version` subcommand, §4).
- Everything the RUN downloads is deleted in the same layer except `/usr/local/bin/tea`, and apt lists are cleaned, matching the `rm -rf /var/lib/apt/lists/*` convention in the other `*_TOOLS` blocks.
