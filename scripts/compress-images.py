#!/usr/bin/env python3
"""Normalize every raster image in a starter to the size budget, in place.

Called by cut-starter.sh after the file selection is copied in. The budget
is long edge 1600px, JPEG quality 82, progressive, 4:2:0 chroma
subsampling -- every JPEG is re-encoded to that recipe unconditionally, not
only the ones over the dimension limit, because a full-site source image
can already be within 1600px on its long edge while still carrying a much
higher effective quality (a real case: 畫/安晚冊.jpg is 1010x995 -- already
"in budget" by dimension -- at 330KB; the committed starter's own version
of the same file, cut under this same recipe, is 132KB). Dimension-only
gating would silently ship that source's full weight. Re-encoding a source
that happens to already be small can occasionally grow it a little (mild
double-compression on an already low-quality source); that is reported,
not hidden, rather than special-cased away. PNG assets keep their format
(resize only, no re-encode) since a PNG's own compression isn't lossy in
the way a quality setting addresses.

1600/82 is a starter budget, not a display budget: it's deliberately below
moss's own deploy default of 2400px/quality 80 WebP (retina, see
`ImageCompressionConfig::default()` in moss-build's
`build/media/image.rs`) because a starter only has to demonstrate the site,
not serve it at full fidelity -- a real deploy re-derives its own assets
from source at moss's own budget regardless of what a starter ships.

Every JPEG's EXIF `Orientation` tag is applied to the pixels before
resizing/encoding (`ImageOps.exif_transpose`) and the tag itself is never
written back out (this script never passes `exif=` to `save`), the same
order moss's own pipeline uses (`apply_exif_orientation` before encode, in
the same file) -- decode-time orientation, never a tag left for the browser
to apply a second time.

Usage: compress-images.py <starter-dir> [long_edge] [jpeg_quality]
"""
import sys
from pathlib import Path

from PIL import Image, ImageOps

LONG_EDGE_DEFAULT = 1600
QUALITY_DEFAULT = 82


def process(path: Path, long_edge: int, quality: int) -> str:
    before = path.stat().st_size
    with Image.open(path) as im:
        source_format = im.format  # exif_transpose returns a copy with format=None
        im = ImageOps.exif_transpose(im)  # bake in rotation/flip, drop the tag
        w, h = im.size
        needs_resize = max(w, h) > long_edge

        if needs_resize:
            scale = long_edge / float(max(w, h))
            new_size = (max(1, round(w * scale)), max(1, round(h * scale)))
            im = im.resize(new_size, Image.LANCZOS)

        if source_format == "PNG":
            im.save(path, format="PNG", optimize=True)
        else:
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            im.save(
                path,
                format="JPEG",
                quality=quality,
                optimize=True,
                progressive=True,
                subsampling=2,  # 4:2:0
                # No exif= kwarg: the orientation tag is already baked into
                # the pixels above, and no other EXIF is carried forward.
            )

    after = path.stat().st_size
    verb = "resized+recompressed" if needs_resize else "recompressed"
    delta = "smaller" if after < before else ("larger" if after > before else "unchanged")
    return f"{verb} ({before}B -> {after}B, {delta})"


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    root = Path(sys.argv[1])
    long_edge = int(sys.argv[2]) if len(sys.argv) > 2 else LONG_EDGE_DEFAULT
    quality = int(sys.argv[3]) if len(sys.argv) > 3 else QUALITY_DEFAULT

    exts = {".jpg", ".jpeg", ".png"}
    count_touched = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in exts:
            continue
        # Never touch theme font files or anything under .moss/theme/fonts.
        if ".moss/theme/fonts" in str(path):
            continue
        try:
            result = process(path, long_edge, quality)
        except Exception as exc:  # noqa: BLE001 - report and keep going
            print(f"compress-images: FAILED {path}: {exc}", file=sys.stderr)
            return 1
        count_touched += 1
        print(f"compress-images: {path} -> {result}")

    print(f"compress-images: {count_touched} image(s) processed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
