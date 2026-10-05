#!/usr/bin/env bash
# cut-starter.sh -- rebuild a starter's site/ folder as a reproducible subset
# of the full site it is cut from.
#
# Usage: scripts/cut-starter.sh <full-site-dir> <starter-id>
#
# Reads starters/<id>/.cut -- paths relative to the full site's root, one per
# line, a directory copies recursively, comments start with `#` -- empties
# starters/<id>/site/, rsyncs exactly those paths in from the full site, then
# post-processes the copy in place:
#
#   1. strips every `uid:` frontmatter line (minted fresh on the user's own
#      first build; a starter must never ship one)
#   2. drops `domain`, `site_id` and `[channels.*]` from .moss/config.toml,
#      keeping schema_version, [site] display keys, and [terms.*] (deploy
#      and identity live in .moss/state.toml, never in config.toml, and
#      state.toml is refused by the forbidden-path check below)
#   3. prunes .moss/places.toml down to places an included page's
#      `location:` frontmatter actually names (scripts/prune-places.py)
#   4. prunes any folder's `sort:` frontmatter list down to siblings the
#      cut actually kept (scripts/prune-sort-lists.py) -- the same shape of
#      problem as (3), just against a directory listing instead of the
#      gazetteer
#   5. normalizes every raster image to the size budget -- long edge
#      1600px, JPEG quality 82, progressive, 4:2:0 (scripts/compress-images.py);
#      applied unconditionally, not just to oversized images, because a
#      full-site source already under 1600px can still carry a much higher
#      effective quality than the budget calls for
#   6. runs starters/<id>/fixups.sh, if it exists, with the working
#      directory at site/ -- a small, idempotent script of one-off textual
#      corrections that are editorial calls rather than integrity checks, so
#      they cannot be inferred mechanically
#   7. runs scripts/check-starters.sh as a final backstop
#
# The full site is only ever read from, never written to.
#
# Two things inside site/ belong to the starter, not the full site, and
# survive the wipe unchanged: .moss/STARTER.md and .moss/templates/. They are
# copied to a scratch directory before the wipe and copied back after the
# fresh rsync, untouched by any post-processing step above. .cut and
# fixups.sh live beside site/, outside the wipe.
#
# Idempotent: every run rsyncs fresh from the full site rather than
# re-processing the starter's own previous copy, so running this twice in a
# row produces no diff.
#
# Every .cut entry is validated -- exists under the full site, at least one
# entry present, no forbidden path -- before anything under site/ is touched,
# so a bad .cut fails loudly with the starter still intact.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <full-site-dir> <starter-id>" >&2
  exit 2
fi

full_site=$1
starter_id=$2

[[ "$starter_id" == */* ]] && { echo "cut-starter: starter id must not contain '/': $starter_id" >&2; exit 2; }

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

starter_root="starters/$starter_id"
starter_dir="$starter_root/site"
cut_file="$starter_root/.cut"

[[ -d "$full_site" ]] || { echo "cut-starter: no such full site: $full_site" >&2; exit 1; }
[[ -f "$cut_file" ]] || { echo "cut-starter: missing $cut_file" >&2; exit 1; }

# Paths a starter must never carry, even if .cut lists one by mistake --
# build output and secrets, never source.
forbidden_re='^(\.moss/(build[^/]*|cache|identity|keys|state\.toml|notes|data)|\.claude|\.cursor)(/|$)'

entries=()
while IFS= read -r line; do
  entries+=("$line")
done < <(grep -v '^[[:space:]]*#' "$cut_file" | grep -v '^[[:space:]]*$')

# --- validate everything before touching the starter directory ---------
# A missing full-site path, an empty .cut, or a forbidden path must be
# caught now: once the wipe below runs, the starter (including its own
# .cut) is gone until this script successfully rebuilds it, so a failure
# partway through the copy loop used to leave it stripped bare.

[[ ${#entries[@]} -gt 0 ]] || { echo "cut-starter: $cut_file has no entries (all blank/comments?)" >&2; exit 1; }

for entry in "${entries[@]}"; do
  if [[ "$entry" =~ $forbidden_re && "$entry" != ".moss/data/redirects.json" ]]; then
    echo "cut-starter: refusing '$entry' -- build/cache/identity paths are never source" >&2
    exit 1
  fi
  if [[ ! -e "$full_site/$entry" ]]; then
    echo "cut-starter: '$entry' not found under $full_site" >&2
    exit 1
  fi
done

# --- preserve the starter's own files, wipe, rebuild from .cut ---------

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

if [[ -f "$starter_dir/.moss/STARTER.md" ]]; then
  mkdir -p "$stage/.moss"
  cp -p "$starter_dir/.moss/STARTER.md" "$stage/.moss/STARTER.md"
fi
if [[ -d "$starter_dir/.moss/templates" ]]; then
  mkdir -p "$stage/.moss"
  cp -pR "$starter_dir/.moss/templates" "$stage/.moss/templates"
fi

mkdir -p "$starter_dir"
find "$starter_dir" -mindepth 1 -delete

for entry in "${entries[@]}"; do
  src="$full_site/$entry"
  dest="$starter_dir/$entry"
  if [[ -d "$src" ]]; then
    mkdir -p "$dest"
    rsync -a "$src/" "$dest/"
  else
    mkdir -p "$(dirname "$dest")"
    rsync -a "$src" "$dest"
  fi
done

cp -pR "$stage/." "$starter_dir/"  # no-op when nothing was staged

# --- post-process --------------------------------------------------------

# 1. uid: frontmatter is minted per-site on first build; never ship one.
find "$starter_dir" -name '*.md' -exec perl -ni -e 'print unless /^uid:/' {} +

# 2. .moss/config.toml: drop channel/deploy-identity keys, keep display config.
config="$starter_dir/.moss/config.toml"
if [[ -f "$config" ]]; then
  awk '
    BEGIN { drop_section = 0; prevblank = 1 }
    /^\[channels\./ { drop_section = 1; next }
    /^\[/ {
      drop_section = 0
      if (!prevblank) print ""
      print
      prevblank = 0
      next
    }
    drop_section { next }
    /^domain[[:space:]]*=/ { next }
    /^site_id[[:space:]]*=/ { next }
    {
      print
      prevblank = ($0 == "")
    }
  ' "$config" > "$config.tmp"
  mv "$config.tmp" "$config"
fi

# 3. .moss/places.toml: drop entries no included page's `location:` names.
python3 scripts/prune-places.py "$starter_dir"

# 4. sort: frontmatter lists: drop entries the cut didn't keep.
python3 scripts/prune-sort-lists.py "$starter_dir"

# 5. Normalize every image to the size budget.
python3 scripts/compress-images.py "$starter_dir" 1600 82

# 6. Starter-specific, one-off, idempotent textual corrections.
if [[ -f "$starter_root/fixups.sh" ]]; then
  ( cd "$starter_dir" && bash "$repo_root/$starter_root/fixups.sh" )
fi

# 7. Backstop: the starter meets the contract (uid, forbidden paths, config).
scripts/check-starters.sh --site-only "$starter_id"
