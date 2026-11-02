#!/bin/sh
# Release build with libpdfium placed next to the binary (<target>/release/).
set -eu
cd "$(dirname "$0")/.."
./scripts/fetch-pdfium.sh
cargo build --release
lib=libpdfium.so; [ "$(uname -s)" = Darwin ] && lib=libpdfium.dylib
out="${CARGO_TARGET_DIR:-target}/release"
cp "vendor/$lib" "$out/$lib"
echo "built: $out/pdf-ocr"
