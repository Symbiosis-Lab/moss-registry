#!/usr/bin/env bash
# check-starters.sh -- validate starters against the contract in
# starters/README.md.
#
# Usage: scripts/check-starters.sh [--site-only] [<starter-id> ...]
#        (default: every starter; --site-only checks just the site/ guarantees,
#        which is what cut-starter.sh needs before a manifest and posters exist)
#
# Static checks, always: manifest fields and values, id equals the folder
# name, both posters present and exactly 1600x1000 JPEG, the guarantees on
# site/ (a home page carrying `home: true`, no `uid:` lines, none of the
# build/identity/secret paths, no deploy keys in .moss/config.toml, under 25
# MB, .moss/STARTER.md present), and tour paths well-formed.
#
# With MOSS=/path/to/moss, each starter is also built with --strict in a
# scratch copy (never in the repo: moss writes `uid:` lines into whatever it
# builds) and every tour path must resolve to a built index.html.
exec python3 "$(dirname "$0")/check_starters.py" "$@"
