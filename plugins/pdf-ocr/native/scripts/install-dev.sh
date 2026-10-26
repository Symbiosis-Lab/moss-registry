#!/bin/sh
# Install this plugin into a moss site for local use, pointing at the locally
# built binary instead of the release download the registry publishes.
set -eu
site="${1:?usage: install-dev.sh <site folder>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
bin="$root/target/release/pdf-ocr"
[ -x "$bin" ] || { echo "build first: scripts/build.sh" >&2; exit 1; }
dest="$site/.moss/plugins/pdf-ocr"
mkdir -p "$dest"
python3 -I - "$root/../assets/manifest.json" "$bin" "$dest/manifest.json" <<'PY'
import json, sys
src, binary, out = sys.argv[1:]
manifest = json.load(open(src))
for derivation in manifest["contributes"]["derivations"].values():
    derivation["run"]["artifact"] = [{"kind": "path", "binary": binary}]
json.dump(manifest, open(out, "w"), indent=2)
PY
echo "installed pdf-ocr into $dest"
