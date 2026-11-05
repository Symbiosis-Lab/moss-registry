#!/bin/sh
# Build and package the release for Linux: pdf-ocr, libpdfium, and Tesseract with
# its English language data, as one tar.gz a moss plugin can download. Logs go to
# stderr; the archive's path is the last line of stdout.
#
#     scripts/package-linux.sh linux-x64|linux-arm64
#
# Tesseract and leptonica are built from source at the versions vendor.toml pins,
# which are the versions the darwin build ships, so both print the same
# `tesseract --version` and read a page the same way (Ubuntu packages older ones).
# Tesseract is linked statically against leptonica, libpng, zlib, libstdc++ and
# libgcc, so the bundle needs only glibc (and libgcc_s, which every Rust program
# needs and every glibc system has), and the oldest glibc it runs on is the
# build host's: CI builds on Ubuntu 22.04 (glibc 2.35).
set -eu
plat="${1:?usage: package-linux.sh linux-x64|linux-arm64}"
cd "$(dirname "$0")/.."
case "$plat-$(uname -s)-$(uname -m)" in
  linux-x64-Linux-x86_64 | linux-arm64-Linux-aarch64) ;;
  *) echo "build $plat on a $plat host, not $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
exec 3>&1 1>&2

missing=""
for p in g++ make cmake pkg-config curl libpng-dev zlib1g-dev; do
  dpkg -s "$p" >/dev/null 2>&1 || missing="$missing $p"
done
if [ -n "$missing" ]; then
  sudo apt-get update -qq
  # shellcheck disable=SC2086
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $missing
fi
if ! command -v cargo >/dev/null 2>&1; then
  curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
  . "$HOME/.cargo/env"
fi

tv=$(scripts/pin.sh tesseract version)
lv=$(scripts/pin.sh leptonica version)
deps="$PWD/vendor/$plat"
prefix="$deps/prefix"
mkdir -p "$deps"

# The pinned file of a vendor.toml section, downloaded once and checked every time.
fetch() {
  url=$(scripts/pin.sh "$1" url)
  f="$deps/$1-$(basename "$url")"
  [ -f "$f" ] || curl -fsSL -o "$f" "$url"
  echo "$(scripts/pin.sh "$1" sha256)  $f" | sha256sum -c --quiet - || { rm -f "$f"; exit 1; }
  echo "$f"
}

# A change to the pins or to this script rebuilds; anything else reuses the build.
stamp=$(cat vendor.toml scripts/package-linux.sh | sha256sum | cut -c1-64)
if [ "$(cat "$prefix/.stamp" 2>/dev/null)" != "$stamp" ]; then
  rm -rf "$deps/src" "$prefix"
  mkdir -p "$deps/src"
  tar -xzf "$(fetch leptonica)" -C "$deps/src"
  tar -xzf "$(fetch tesseract)" -C "$deps/src"
  jobs=$(nproc)

  # Only what reading pdf-ocr's PNG pages needs: libpng and zlib, linked statically.
  cmake -S "$deps/src/leptonica-$lv" -B "$deps/src/leptonica-build" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
    -DBUILD_SHARED_LIBS=OFF -DBUILD_PROG=OFF -DSW_BUILD=OFF \
    -DENABLE_GIF=OFF -DENABLE_JPEG=OFF -DENABLE_TIFF=OFF -DENABLE_WEBP=OFF -DENABLE_OPENJPEG=OFF \
    -DENABLE_PNG=ON -DENABLE_ZLIB=ON \
    -DPNG_LIBRARY="$(gcc -print-file-name=libpng.a)" -DZLIB_LIBRARY="$(gcc -print-file-name=libz.a)"
  cmake --build "$deps/src/leptonica-build" -j "$jobs"
  cmake --install "$deps/src/leptonica-build"

  # No -march=native: the binary must run on any CPU of its architecture, and
  # Tesseract picks its SIMD code at run time.
  cmake -S "$deps/src/tesseract-$tv" -B "$deps/src/tesseract-build" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_PREFIX_PATH="$prefix" \
    -DBUILD_SHARED_LIBS=OFF -DBUILD_TRAINING_TOOLS=OFF -DBUILD_TESTS=OFF -DSW_BUILD=OFF \
    -DENABLE_NATIVE=OFF -DOPENMP_BUILD=OFF -DGRAPHICS_DISABLED=ON \
    -DDISABLE_ARCHIVE=ON -DDISABLE_CURL=ON -DDISABLE_TIFF=ON \
    -DCMAKE_EXE_LINKER_FLAGS="-static-libstdc++ -static-libgcc"
  cmake --build "$deps/src/tesseract-build" -j "$jobs"
  cmake --install "$deps/src/tesseract-build"
  echo "$stamp" > "$prefix/.stamp"
fi

scripts/build.sh
version=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
release="${CARGO_TARGET_DIR:-target}/release"
stage="$PWD/dist/$plat"
out="$stage/pdf-ocr"
rm -rf "$stage"
mkdir -p "$out/tessdata" "$out/licenses"
cp "$release/pdf-ocr" "$release/libpdfium.so" "$prefix/bin/tesseract" "$out/"
cp "$(fetch eng-traineddata)" "$out/tessdata/eng.traineddata"

got=$("$out/tesseract" --version | head -2 | tr '\n' '|')
[ "$got" = "tesseract $tv| leptonica-$lv|" ] || { echo "built tesseract reports '$got'; vendor.toml pins $tv and $lv" >&2; exit 1; }
for f in "$out/pdf-ocr" "$out/tesseract" "$out/libpdfium.so"; do
  extra=$(readelf -d "$f" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p' \
    | grep -vxE 'libgcc_s\.so\.1|libc\.so\.6|libm\.so\.6|libdl\.so\.2|libpthread\.so\.0|librt\.so\.1|ld-linux.*\.so\.[0-9]' || true)
  [ -z "$extra" ] || { echo "$(basename "$f") needs libraries beyond glibc: $extra" >&2; exit 1; }
done

# licences of what ships: pdfium's from its archive, the sources' for the rest
cp vendor/LICENSE "$out/licenses/pdfium-LICENSE"
[ -d vendor/licenses ] && cp -R vendor/licenses "$out/licenses/pdfium-third-party"
cp "$deps/src/tesseract-$tv/LICENSE" "$out/licenses/tesseract-LICENSE"
cp licenses/* "$out/licenses/"
cp /usr/share/doc/zlib1g/copyright "$out/licenses/zlib-copyright"
cp "$(ls /usr/share/doc/libpng16-16*/copyright | head -1)" "$out/licenses/libpng-copyright"
cp LICENSE "$out/licenses/pdf-ocr-LICENSE"

tgz="$PWD/dist/pdf-ocr-$version-$plat.tar.gz"
tar --sort=name --owner=0 --group=0 --numeric-owner -C "$stage" -czf "$tgz" pdf-ocr
echo "$(sha256sum "$tgz" | cut -c1-64)  $(basename "$tgz"), $("$out/tesseract" --version | head -1)"
echo "$tgz" >&3
