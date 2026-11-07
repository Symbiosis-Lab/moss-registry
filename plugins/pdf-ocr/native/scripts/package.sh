#!/bin/sh
# Build and package the release: pdf-ocr, libpdfium, and Tesseract with its
# English language data, as one tar.gz a moss plugin can download. Logs go to
# stderr; the archive's path is the last line of stdout.
#
#     scripts/package.sh darwin-arm64|linux-x64|linux-arm64
#
# Tesseract and leptonica are built from the sources vendor.toml pins, so every
# build prints the same `tesseract --version` and reads a page the same way.
# They are linked statically with only what reading pdf-ocr's PNG pages needs
# (libpng, zlib), so the archive needs nothing beyond the system:
# - Linux: libstdc++ and libgcc are static too, so it needs only glibc (and
#   libgcc_s, which every Rust program needs), and the oldest glibc it runs on is
#   the build host's: CI builds on Ubuntu 22.04 (glibc 2.35).
# - macOS: libpng is built from source, zlib and libc++ are the system's, and
#   everything compiled here targets macOS 12 whatever the build host is. Every
#   Mach-O in the archive is checked to declare no newer minimum, except the
#   prebuilt pdfium, whose minimum is printed.
set -eu
plat="${1:?usage: package.sh darwin-arm64|linux-x64|linux-arm64}"
cd "$(dirname "$0")/.."
case "$plat-$(uname -s)-$(uname -m)" in
  darwin-arm64-Darwin-arm64 | linux-x64-Linux-x86_64 | linux-arm64-Linux-aarch64) ;;
  *) echo "build $plat on a $plat host, not $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
exec 3>&1 1>&2

if [ "$plat" != darwin-arm64 ]; then
  missing=""
  for p in g++ make cmake pkg-config curl libpng-dev zlib1g-dev; do
    dpkg -s "$p" >/dev/null 2>&1 || missing="$missing $p"
  done
  if [ -n "$missing" ]; then
    sudo apt-get update -qq
    # shellcheck disable=SC2086
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $missing
  fi
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

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -c1-64
}

# The pinned file of a vendor.toml section, downloaded once and checked every time.
fetch() {
  url=$(scripts/pin.sh "$1" url)
  f="$deps/$1-$(basename "$url")"
  [ -f "$f" ] || curl -fsSL -o "$f" "$url"
  [ "$(sha256 "$f")" = "$(scripts/pin.sh "$1" sha256)" ] || { echo "sha256 mismatch: $f" >&2; rm -f "$f"; exit 1; }
  echo "$f"
}

jobs=$(nproc 2>/dev/null || sysctl -n hw.ncpu)
if [ "$plat" = darwin-arm64 ]; then
  export MACOSX_DEPLOYMENT_TARGET=12.0
  # Homebrew's libraries must not leak in: they target the build host's macOS.
  # Tesseract's CMakeLists reads HOMEBREW_PREFIX to look for icu and libarchive.
  unset HOMEBREW_PREFIX
  export PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig"
  os_flags="-DCMAKE_OSX_DEPLOYMENT_TARGET=$MACOSX_DEPLOYMENT_TARGET -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_IGNORE_PREFIX_PATH=/opt/homebrew;/usr/local"
  link_flags=""
else
  os_flags=""
  link_flags="-static-libstdc++ -static-libgcc"
fi

# A change to the pins or to this script rebuilds; anything else reuses the build.
stamp=$(cat vendor.toml scripts/package.sh | sha256 -)
if [ "$(cat "$prefix/.stamp" 2>/dev/null)" != "$stamp" ]; then
  rm -rf "$deps/src" "$prefix"
  mkdir -p "$deps/src" "$prefix/licenses"
  for pin in leptonica tesseract; do
    src=$(fetch $pin)
    tar -xzf "$src" -C "$deps/src"
  done
  if [ "$plat" = darwin-arm64 ]; then
    pv=$(scripts/pin.sh libpng version)
    src=$(fetch libpng)
    tar -xzf "$src" -C "$deps/src"
    # shellcheck disable=SC2086
    cmake -S "$deps/src/libpng-$pv" -B "$deps/src/libpng-build" $os_flags \
      -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" \
      -DPNG_SHARED=OFF -DPNG_STATIC=ON -DPNG_FRAMEWORK=OFF -DPNG_TESTS=OFF -DPNG_TOOLS=OFF
    cmake --build "$deps/src/libpng-build" -j "$jobs"
    cmake --install "$deps/src/libpng-build"
    cp "$deps/src/libpng-$pv/LICENSE" "$prefix/licenses/libpng-LICENSE"
    png_flags="-DPNG_LIBRARY=$prefix/lib/libpng16.a -DPNG_PNG_INCLUDE_DIR=$prefix/include"
  else
    png_flags="-DPNG_LIBRARY=$(gcc -print-file-name=libpng.a) -DZLIB_LIBRARY=$(gcc -print-file-name=libz.a)"
  fi

  # shellcheck disable=SC2086
  cmake -S "$deps/src/leptonica-$lv" -B "$deps/src/leptonica-build" $os_flags \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
    -DBUILD_SHARED_LIBS=OFF -DBUILD_PROG=OFF -DSW_BUILD=OFF \
    -DENABLE_GIF=OFF -DENABLE_JPEG=OFF -DENABLE_TIFF=OFF -DENABLE_WEBP=OFF -DENABLE_OPENJPEG=OFF \
    -DENABLE_PNG=ON -DENABLE_ZLIB=ON $png_flags
  cmake --build "$deps/src/leptonica-build" -j "$jobs"
  cmake --install "$deps/src/leptonica-build"

  # No -march=native: the binary must run on any CPU of its architecture, and
  # Tesseract picks its SIMD code at run time.
  # shellcheck disable=SC2086
  cmake -S "$deps/src/tesseract-$tv" -B "$deps/src/tesseract-build" $os_flags \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_PREFIX_PATH="$prefix" \
    -DBUILD_SHARED_LIBS=OFF -DBUILD_TRAINING_TOOLS=OFF -DBUILD_TESTS=OFF -DSW_BUILD=OFF \
    -DENABLE_NATIVE=OFF -DOPENMP_BUILD=OFF -DGRAPHICS_DISABLED=ON -DENABLE_CCACHE=OFF \
    -DDISABLE_ARCHIVE=ON -DDISABLE_CURL=ON -DDISABLE_TIFF=ON \
    -DCMAKE_EXE_LINKER_FLAGS="$link_flags"
  cmake --build "$deps/src/tesseract-build" -j "$jobs"
  cmake --install "$deps/src/tesseract-build"
  cp "$deps/src/tesseract-$tv/LICENSE" "$prefix/licenses/tesseract-LICENSE"
  rm -rf "$deps/src"
  echo "$stamp" > "$prefix/.stamp"
fi

scripts/build.sh
version=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)
release="${CARGO_TARGET_DIR:-target}/release"
stage="$PWD/dist/$plat"
out="$stage/pdf-ocr"
rm -rf "$stage"
mkdir -p "$out/tessdata" "$out/licenses"
cp "$release/pdf-ocr" "$release"/libpdfium.* "$prefix/bin/tesseract" "$out/"
cp "$(fetch eng-traineddata)" "$out/tessdata/eng.traineddata"

got=$("$out/tesseract" --version | head -2 | tr '\n' '|')
[ "$got" = "tesseract $tv| leptonica-$lv|" ] || { echo "built tesseract reports '$got'; vendor.toml pins $tv and $lv" >&2; exit 1; }

if [ "$plat" = darwin-arm64 ]; then
  # Each Mach-O loads only system libraries, is signed (arm64 macOS kills
  # unsigned code), and declares no newer macOS than the deployment target.
  floor=$MACOSX_DEPLOYMENT_TARGET
  num() { echo "$1" | awk -F. '{ printf "%d", $1 * 10000 + $2 * 100 + $3 }'; }
  echo "minimum macOS of each Mach-O in the archive:"
  checked=""
  for f in $(find "$out" -type f | sort); do
    file -b "$f" | grep -q '^Mach-O' || continue
    name=${f#"$stage/"}
    checked="$checked ${f##*/}"
    extra=$(otool -L "$f" | tail -n +2 | awk '{ print $1 }' \
      | grep -vxF "$(otool -D "$f" | sed -n 2p)" | grep -vE '^(/usr/lib/|/System/Library/)' || true)
    [ -z "$extra" ] || { echo "$name loads libraries beyond the system's: $extra" >&2; exit 1; }
    codesign --verify "$f" || { echo "$name is not validly signed" >&2; exit 1; }
    minos=$(vtool -show-build "$f" | awk '$1 == "minos" { print $2; exit }')
    [ -n "$minos" ] || { echo "$name declares no minimum macOS" >&2; exit 1; }
    echo "  $minos  $name"
    [ "$(num "$minos")" -gt "$(num "$floor")" ] || continue
    case "$name" in
      */libpdfium.dylib)
        echo "  note: pdfium $(scripts/pin.sh pdfium.darwin-arm64 release) is prebuilt and declares macOS $minos, above the $floor everything built here targets" ;;
      *) echo "$name declares macOS $minos; everything built here must target $floor" >&2; exit 1 ;;
    esac
  done
  # A check that found nothing to check would pass.
  for want in pdf-ocr tesseract libpdfium.dylib; do
    case " $checked " in *" $want "*) ;; *) echo "the macOS check never saw $want" >&2; exit 1 ;; esac
  done
else
  for f in "$out/pdf-ocr" "$out/tesseract" "$out/libpdfium.so"; do
    extra=$(readelf -d "$f" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p' \
      | grep -vxE 'libgcc_s\.so\.1|libc\.so\.6|libm\.so\.6|libdl\.so\.2|libpthread\.so\.0|librt\.so\.1|ld-linux.*\.so\.[0-9]' || true)
    [ -z "$extra" ] || { echo "$(basename "$f") needs libraries beyond glibc: $extra" >&2; exit 1; }
  done
fi

# licences of what ships: pdfium's from its archive, the sources' for the rest
cp vendor/LICENSE "$out/licenses/pdfium-LICENSE"
[ -d vendor/licenses ] && cp -R vendor/licenses "$out/licenses/pdfium-third-party"
cp "$prefix"/licenses/* licenses/* "$out/licenses/"
if [ "$plat" != darwin-arm64 ]; then
  cp /usr/share/doc/zlib1g/copyright "$out/licenses/zlib-copyright"
  cp "$(ls /usr/share/doc/libpng16-16*/copyright | head -1)" "$out/licenses/libpng-copyright"
fi
cp LICENSE "$out/licenses/pdf-ocr-LICENSE"

tgz="$PWD/dist/pdf-ocr-$version-$plat.tar.gz"
if [ "$plat" = darwin-arm64 ]; then
  # no AppleDouble files or extended attributes, which would unpack as stray files
  COPYFILE_DISABLE=1 tar --no-mac-metadata --uid 0 --gid 0 --uname root --gname wheel -C "$stage" -czf "$tgz" pdf-ocr
else
  tar --sort=name --owner=0 --group=0 --numeric-owner -C "$stage" -czf "$tgz" pdf-ocr
fi
echo "$(sha256 "$tgz")  $(basename "$tgz"), $("$out/tesseract" --version | head -1)"
echo "$tgz" >&3
