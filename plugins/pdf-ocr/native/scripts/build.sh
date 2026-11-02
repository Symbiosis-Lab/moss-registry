#!/bin/sh
# Release build with libpdfium placed next to the binary (<target>/release/).
set -eu
cd "$(dirname "$0")/.."
./scripts/fetch-pdfium.sh
cargo build --release
out="${CARGO_TARGET_DIR:-target}/release"
cp vendor/libpdfium.* "$out/"
echo "built: $out/pdf-ocr"
