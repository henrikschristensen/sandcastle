#!/usr/bin/env bash
# Publish the wayfinder map and its tickets to the GitHub issue tracker.
# Run from the repo root with a gh token that can create issues:
#   gh auth login   # or GH_TOKEN=... ./plans/tea-codeberg/publish-to-tracker.sh
# Env: REPO (default mattpocock/sandcastle)
set -euo pipefail

REPO="${REPO:-mattpocock/sandcastle}"
DIR="$(cd "$(dirname "$0")" && pwd)"

# Print a file's body with the leading --- frontmatter block stripped.
body() { awk 'NR==1 && $0=="---" {fm=1; next} fm && $0=="---" {fm=0; next} !fm {print}' "$1"; }
# Read one frontmatter field (first match).
fm() { awk -v key="$2" 'NR==1 && $0=="---" {fm=1; next} fm && $0=="---" {exit} fm && index($0, key":")==1 {sub("^[^:]*: *",""); gsub(/^"|"$/,""); print; exit}' "$1"; }
# Create an issue and echo its number (create prints the issue URL).
create_issue() { local url; url=$(gh issue create --repo "$REPO" "$@") && echo "${url##*/}"; }

if [ -n "${MAP:-}" ]; then
  echo "==> Using existing map issue #$MAP (MAP env set)"
else
  echo "==> Guard: no existing map for this effort"
  EXISTING=$(gh issue list --repo "$REPO" --label wayfinder:map --state all --search "tea/codeberg" --limit 5 --json number -q 'if length>0 then .[0].number else empty end')
  if [ -n "$EXISTING" ]; then
    echo "    map already exists: #$EXISTING — set MAP=$EXISTING to resume, or pick another title. Abort." >&2
    exit 1
  fi
  echo "==> Creating map issue"
  TMPMAP=$(mktemp)
  body "$DIR/map.md" > "$TMPMAP"
  MAP=$(create_issue \
    --title "Wayfinder: support tea/codeberg (Gitea as an init issue tracker)" \
    --label wayfinder:map \
    --body-file "$TMPMAP")
  rm -f "$TMPMAP"
  echo "    map = #$MAP"
fi

declare -A NUM

echo "==> Creating tickets (in blocked_by-tolerant order: tickets are numbered topologically)"
for f in "$DIR"/tickets/*.md; do
  slug=$(basename "$f" .md)
  type=$(fm "$f" type)
  title=$(fm "$f" title)
  blockers=$(fm "$f" blocked_by | tr -d '[]' | tr ',' ' ')
  args=(--title "$title" --label "wayfinder:$type" --parent "$MAP")
  blocked_flag=()
  for b in $blockers; do
    [ -z "${NUM[$b]:-}" ] && { echo "    $slug blocked by $b which has no issue number yet" >&2; exit 1; }
    blocked_flag+=("${NUM[$b]}")
  done
  [ ${#blocked_flag[@]} -gt 0 ] && args+=(--blocked-by "$(IFS=,; echo "${blocked_flag[*]}")")
  # body convention: append ## Blocked by with issue links (authoritative alongside the native edges)
  TMPBODY=$(mktemp)
  body "$f" > "$TMPBODY"
  if [ -n "$blockers" ]; then
    {
      echo
      echo "## Blocked by"
      echo
      for b in $blockers; do
        [ -z "${NUM[$b]:-}" ] && continue
        echo "- #${NUM[$b]}"
      done
    } >> "$TMPBODY"
  fi
  args+=(--body-file "$TMPBODY")
  n=$(create_issue "${args[@]}")
  rm -f "$TMPBODY"
  NUM[$slug]=$n
  echo "    #$n  $slug"
done

echo "==> Done: map #$MAP, tickets ${NUM[*]}"
echo "MAP=$MAP"
