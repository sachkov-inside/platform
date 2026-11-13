#!/usr/bin/env bash
# A release or deployment run starts only under the production lock (docs/agents/production-lock.md):
# LOCK names an open Issue labelled production-lock, and it is the lowest-numbered open one (#2138).
set -euo pipefail

lock="${LOCK:-}"
lock="${lock#\#}"
if [[ ! "$lock" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::Pass the production lock Issue number in the lock field (docs/agents/production-lock.md)." >&2
  exit 1
fi

holder="$(gh api "repos/$GITHUB_REPOSITORY/issues?labels=production-lock&state=open&per_page=100" |
  jq -r '[.[] | select(.pull_request == null) | .number] | min // empty')"
held_by="${holder:+ Production is held by #$holder.}"

if ! issue="$(gh api "repos/$GITHUB_REPOSITORY/issues/$lock" 2>/dev/null)" ||
  ! jq -e '.pull_request == null and .state == "open" and any(.labels[]?; .name == "production-lock")' \
    >/dev/null <<<"$issue"; then
  echo "::error::#$lock is not an open Issue with label production-lock; open the lock first (docs/agents/production-lock.md).$held_by" >&2
  exit 1
fi

if [[ "$holder" != "$lock" ]]; then
  echo "::error::production is held by #${holder:-unknown}; wait for it to close or ask the owner." >&2
  exit 1
fi

echo "Production lock #$lock holds production."
