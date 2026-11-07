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
fm() { awk -v key="$2" 'NR==1 && $0=="---" {fm=1; next} fm && $0=="---" {exit} fm && index($0, key":")==1 {sub("^[^:]*: *",""); gsub(/^\"|\"$/,""); print; exit}' "$1"; }

declare -A NUM NODE

echo "==> Creating map issue"
MAP=$(gh issue create --repo "$REPO" \
  --title "Wayfinder: support tea/codeberg (Gitea as an init issue tracker)" \
  --label wayfinder:map \
  --body-file <(body "$DIR/map.md") --json number -q .number)
echo "    map = #$MAP"

echo "==> Creating tickets"
for f in "$DIR"/tickets/*.md; do
  slug=$(basename "$f" .md)
  type=$(fm "$f" type)
  title=$(fm "$f" title)
  n=$(gh issue create --repo "$REPO" --title "$title" \
    --label "wayfinder:$type" \
    --body-file <(body "$f") --json number -q .number)
  NUM[$slug]=$n
  NODE[$slug]=$(gh issue view "$n" --repo "$REPO" --json id -q .id)
  echo "    #$n  $slug"
done

echo "==> Wiring sub-issues and blocking edges"
for f in "$DIR"/tickets/*.md; do
  slug=$(basename "$f" .md)
  n=${NUM[$slug]}
  # attach to the map
  gh api graphql --repo "$REPO" -f query='
    mutation($parent:ID!, $child:ID!) {
      addSubIssue(input: {issueId: $parent, subIssueId: $child}) { clientMutationId }
    }' -f parent="$(gh issue view "$MAP" --repo "$REPO" --json id -q .id)" -f child="${NODE[$slug]}" >/dev/null
  # native blocked-by edges (best effort; the ticket body convention is authoritative)
  blockers=$(fm "$f" blocked_by | tr -d '[]' | tr ',' ' ')
  for b in $blockers; do
    [ -z "${NUM[$b]:-}" ] && continue
    gh api graphql --repo "$REPO" -f query='
      mutation($issue:ID!, $blocker:ID!) {
        addBlockedBy(input: {issueId: $issue, blockedById: $blocker}) { clientMutationId }
      }' -f issue="${NODE[$slug]}" -f blocker="${NODE[$b]}" >/dev/null 2>&1 || true
  done
  # body convention: append ## Blocked by with issue links
  if [ -n "$blockers" ]; then
    {
      body "$f"
      echo
      echo "## Blocked by"
      echo
      for b in $blockers; do
        [ -z "${NUM[$b]:-}" ] && continue
        echo "- #${NUM[$b]}"
      done
    } > /tmp/wayfinder-body-$$.md
    gh issue edit "$n" --repo "$REPO" --body-file /tmp/wayfinder-body-$$.md
    rm -f /tmp/wayfinder-body-$$.md
  fi
done

echo "==> Done: map #$MAP, tickets ${NUM[*]}"
