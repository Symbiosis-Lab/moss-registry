#!/usr/bin/env bash
# check-starter-versions.sh -- a change to a starter's site/ or posters/ must
# raise that starter's `version` in manifest.json.
#
# Usage: scripts/check-starter-versions.sh <base-ref> [<head-ref>]   (head defaults to HEAD)
#
# Compares against <base-ref>, so a starter that is new there is skipped (it
# has no earlier version to raise). Versions are compared as semver; any
# increase counts.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

base=${1:?usage: $0 <base-ref> [<head-ref>]}
head=${2:-HEAD}

# `git diff` prints paths with non-ASCII bytes quoted unless told otherwise.
ids=$(git -c core.quotePath=false diff --name-only "$base...$head" -- starters \
  | awk -F/ '$1 == "starters" && NF >= 4 && ($3 == "site" || $3 == "posters") { print $2 }' | sort -u)

if [ -z "$ids" ]; then
  echo "no starter site/ or posters/ changes"
  exit 0
fi

version_at() { git show "$1:starters/$2/manifest.json" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])'; }

fail=0
for id in $ids; do
  if ! git cat-file -e "$base:starters/$id/manifest.json" 2>/dev/null; then
    echo "$id: new starter, nothing to compare"
    continue
  fi
  if ! git cat-file -e "$head:starters/$id/manifest.json" 2>/dev/null; then
    echo "$id: removed, nothing to compare"
    continue
  fi
  old=$(version_at "$base" "$id")
  new=$(version_at "$head" "$id")
  if python3 - "$old" "$new" <<'PY'
import sys
t = lambda v: tuple(int(x) for x in v.split("."))
sys.exit(0 if t(sys.argv[2]) > t(sys.argv[1]) else 1)
PY
  then
    echo "$id: $old -> $new"
  else
    echo "::error::starters/$id changed site/ or posters/ but version is still $new (base has $old). Raise \"version\" in starters/$id/manifest.json."
    fail=1
  fi
done
exit $fail
