#!/bin/sh
# Download and verify this host's pinned pdfium build (vendor.toml) into ./vendor/.
set -eu
cd "$(dirname "$0")/.."
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  plat=darwin-arm64 lib=libpdfium.dylib ;;
  Linux-x86_64)  plat=linux-x64    lib=libpdfium.so ;;
  Linux-aarch64) plat=linux-arm64  lib=libpdfium.so ;;
  *) echo "vendor.toml pins no pdfium for $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
URL=$(scripts/pin.sh "pdfium.$plat" url)
SHA256=$(scripts/pin.sh "pdfium.$plat" sha256)
mkdir -p vendor
if [ -f "vendor/$lib" ] && [ -f vendor/LICENSE ]; then echo "vendor/$lib present"; exit 0; fi
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/p.tgz" "$URL"
got=$(shasum -a 256 "$tmp/p.tgz" 2>/dev/null || sha256sum "$tmp/p.tgz")
got=${got%% *}
[ "$got" = "$SHA256" ] || { echo "sha256 mismatch: $got" >&2; exit 1; }
tar -xzf "$tmp/p.tgz" -C "$tmp"
cp "$tmp/lib/$lib" "vendor/$lib"
# the licences ship with the release beside the library
cp "$tmp/LICENSE" vendor/LICENSE
[ -d "$tmp/licenses" ] && rm -rf vendor/licenses && cp -R "$tmp/licenses" vendor/licenses
echo "ok: vendor/$lib ($(scripts/pin.sh "pdfium.$plat" release))"
