#!/bin/sh
# The registry's build contract: build from this source, package the archive,
# print its path as the last line of stdout. Logs go to stderr.
set -eu
cd "$(dirname "$0")"
command -v tesseract >/dev/null 2>&1 || brew install tesseract >&2
scripts/build.sh >&2
python3 -I scripts/package-macos.py >&2
version=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
echo "$PWD/dist/pdf-ocr-$version-darwin-arm64.tar.gz"
