#!/usr/bin/env bash
# fetch-moss.sh -- download the moss binary that builds starter previews.
#
# Usage: scripts/fetch-moss.sh [<destination>]      (default: dist/moss)
#
# The version and the sha256 of its Linux binary are pinned in starters/moss.json,
# or in the file MOSS_PIN names (plugins/moss.json for the plugins' suites).
# The download is refused unless the hash matches, so what CI executes is exactly
# the bytes a maintainer pinned. Prints the path of the binary on stdout.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${1:-$root/dist/moss}"
pin="${MOSS_PIN:-$root/starters/moss.json}"
version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$pin")"
want="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sha256"])' "$pin")"
url="https://github.com/Symbiosis-Lab/moss/releases/download/v${version}/moss-linux-x86_64"

mkdir -p "$(dirname "$dest")"
curl -fsSL --retry 3 -o "$dest" "$url" >&2

if command -v sha256sum >/dev/null 2>&1; then
  got="$(sha256sum "$dest" | cut -d' ' -f1)"
else
  got="$(shasum -a 256 "$dest" | cut -d' ' -f1)"
fi
if [ "$got" != "$want" ]; then
  rm -f "$dest"
  echo "fetch-moss: sha256 of $url is $got, but $pin pins $want" >&2
  exit 1
fi
chmod +x "$dest"
echo "fetch-moss: moss $version verified" >&2
echo "$dest"
