#!/usr/bin/env python3
"""Drop `.moss/places.toml` entries that no included page references.

places.toml is a sequence of blank-line-separated blocks, each opening with
a `["Name"]` header. This script collects every `location:` frontmatter
value across the starter's own markdown files (a bare word, a quoted
string, or a bracketed list mixing both) and keeps only the blocks whose
name was referenced -- a `parent = "..."` field inside a kept block is left
alone even when that parent has no block of its own (moss resolves it
outside this file).

Text-block based rather than a TOML round-trip, so formatting (key order,
number literals) is preserved byte-for-byte for every block that survives.

Usage: prune-places.py <starter-dir>
"""
import re
import sys
from pathlib import Path

LOCATION_RE = re.compile(r'^location:\s*(.+?)\s*$', re.MULTILINE)
FRONTMATTER_RE = re.compile(r'\A---\n(.*?)\n---\n', re.DOTALL)
BLOCK_HEADER_RE = re.compile(r'^\["((?:[^"\\]|\\.)*)"\]')


def referenced_places(starter_dir: Path) -> set[str]:
    names: set[str] = set()
    for md in starter_dir.rglob("*.md"):
        text = md.read_text(encoding="utf-8")
        fm = FRONTMATTER_RE.match(text)
        if not fm:
            continue
        m = LOCATION_RE.search(fm.group(1))
        if not m:
            continue
        raw = m.group(1).strip()
        if raw.startswith("["):
            raw = raw.strip("[]")
            tokens = [t.strip() for t in raw.split(",")]
        else:
            tokens = [raw]
        for t in tokens:
            t = t.strip().strip('"').strip("'")
            if t:
                names.add(t)
    return names


def prune(places_path: Path, keep: set[str]) -> None:
    text = places_path.read_text(encoding="utf-8")
    blocks = text.split("\n\n")
    kept = []
    dropped = []
    for block in blocks:
        if not block.strip():
            continue
        m = BLOCK_HEADER_RE.match(block.strip())
        if not m:
            # Not a recognizable place block (stray text) -- keep as-is.
            kept.append(block)
            continue
        name = m.group(1)
        if name in keep:
            kept.append(block)
        else:
            dropped.append(name)
    new_text = "\n\n".join(b.strip("\n") for b in kept)
    if new_text and not new_text.endswith("\n"):
        new_text += "\n"
    places_path.write_text(new_text, encoding="utf-8")
    if dropped:
        print(f"prune-places: dropped {', '.join(dropped)}")
    else:
        print("prune-places: nothing to drop")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    starter_dir = Path(sys.argv[1])
    places_path = starter_dir / ".moss" / "places.toml"
    if not places_path.is_file():
        return 0
    keep = referenced_places(starter_dir)
    prune(places_path, keep)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
