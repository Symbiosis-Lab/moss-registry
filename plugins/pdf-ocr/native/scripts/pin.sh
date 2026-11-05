#!/bin/sh
# Print one value from vendor.toml: scripts/pin.sh <section> <key>.
# awk rather than tomllib, which the Python of Ubuntu 22.04 does not have.
set -eu
cd "$(dirname "$0")/.."
v=$(awk -v s="[$1]" -v k="$2" '
  $0 == s { on = 1; next }
  /^\[/   { on = 0 }
  on && $1 == k { sub(/^[^=]*= *"/, ""); sub(/".*$/, ""); print; exit }
' vendor.toml)
[ -n "$v" ] || { echo "vendor.toml has no $2 in [$1]" >&2; exit 1; }
echo "$v"
