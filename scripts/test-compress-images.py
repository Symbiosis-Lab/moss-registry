#!/usr/bin/env python3
"""Regression test for compress-images.py's EXIF-orientation handling.

Builds a small landscape JPEG (40x20 stored pixels) carrying EXIF
Orientation=6 ("rotate 90 CW to display correctly" -- EXIF 2.2 tag
0x0112), runs it through compress_images.process(), and checks:

  1. the output's pixel dimensions are rotated (20x40, not the stored
     40x20) -- proof the orientation was actually applied to the pixels,
     not just ignored (a sideways photo shipping sideways is exactly this
     bug: dimensions come out unrotated)
  2. the output carries no Orientation tag, so a browser never rotates it
     a second time on top of the baked-in rotation

Run directly: python3 scripts/test-compress-images.py

Ablate: comment out the `ImageOps.exif_transpose` call in
compress-images.py and re-run -- check 1 must fail (output stays 40x20)
before the fix and pass (20x40) after it.
"""
import importlib.util
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image

_spec = importlib.util.spec_from_file_location(
    "compress_images", Path(__file__).parent / "compress-images.py"
)
compress_images = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(compress_images)

ORIENTATION_TAG = 0x0112  # EXIF Orientation


def make_oriented_jpeg(path: Path) -> None:
    # Stored (as-shot) pixels: 40 wide x 20 tall -- landscape.
    im = Image.new("RGB", (40, 20), "white")
    exif = im.getexif()
    exif[ORIENTATION_TAG] = 6  # rotate 90 CW to display correctly
    im.save(path, format="JPEG", exif=exif)


def main() -> int:
    tmp = Path(tempfile.mkdtemp())
    try:
        src = tmp / "oriented.jpg"
        make_oriented_jpeg(src)

        with Image.open(src) as fixture:
            assert fixture.size == (40, 20), "fixture should be stored landscape"
            assert fixture.getexif().get(ORIENTATION_TAG) == 6, "fixture should carry Orientation=6"

        compress_images.process(src, 1600, 82)

        with Image.open(src) as out:
            ok = True
            if out.size != (20, 40):
                print(f"FAIL: orientation not applied to pixels -- output size {out.size}, expected (20, 40)")
                ok = False
            tag = out.getexif().get(ORIENTATION_TAG)
            if tag is not None:
                print(f"FAIL: output still carries Orientation={tag}")
                ok = False
            if not ok:
                return 1
        print("PASS: orientation applied to pixels (40x20 -> 20x40), tag dropped")
        return 0
    finally:
        shutil.rmtree(tmp)


if __name__ == "__main__":
    raise SystemExit(main())
