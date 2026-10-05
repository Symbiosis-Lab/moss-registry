#!/usr/bin/env bash
# make-posters.sh -- regenerate a starter's two posters.
#
# Usage: MOSS=/path/to/moss scripts/make-posters.sh <starter-id>
#
# Builds a scratch copy of starters/<id>/site (never the repo itself: moss
# writes `uid:` lines into whatever it builds), screenshots the built home
# page at 1600x1000 in the light and the dark colour scheme, and writes
# starters/<id>/posters/home-light.jpg and home-dark.jpg -- the whole first
# viewport, JPEG quality 85 with full chroma so type stays clean.
#
# Needs Chromium through Playwright (set NODE_PATH to a node_modules that has
# it) and Pillow for python3.
set -euo pipefail

id=${1:?usage: MOSS=/path/to/moss $0 <starter-id>}
: "${MOSS:?set MOSS to a moss binary}"

repo_root=$(git rev-parse --show-toplevel)
site="$repo_root/starters/$id/site"
[[ -d "$site" ]] || { echo "make-posters: no such starter: $id" >&2; exit 1; }

scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cp -R "$site" "$scratch/site"
"$MOSS" build "$scratch/site" --strict >/dev/null

built="$scratch/site/.moss/build.nosync/current"
[[ -d "$built" ]] || built="$scratch/site/.moss/build/current"

mkdir -p "$scratch/png" "$repo_root/starters/$id/posters"
node "$repo_root/scripts/make-posters.cjs" "$built" "$scratch/png"

python3 - "$scratch/png" "$repo_root/starters/$id/posters" <<'PY'
import sys
from PIL import Image
src, dst = sys.argv[1:]
for scheme in ("light", "dark"):
    im = Image.open(f"{src}/home-{scheme}.png").convert("RGB")
    assert im.size == (1600, 1000), im.size
    im.save(f"{dst}/home-{scheme}.jpg", "JPEG", quality=85, subsampling=0, optimize=True)
PY
ls -l "$repo_root/starters/$id/posters"
