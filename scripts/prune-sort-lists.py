#!/usr/bin/env python3
"""Drop `sort:` frontmatter entries that name a sibling the cut excluded.

A folder index page can pin its children's order with `sort: [name, ...]`,
where each name is a sibling's filename stem. Cutting a folder down to a few
children leaves those names dangling unless the list is trimmed to match --
exactly the same shape of problem `prune-places.py` solves for `location:`
references, just against the folder's own directory listing instead of the
gazetteer.

Usage: prune-sort-lists.py <starter-dir>
"""
import re
import sys
from pathlib import Path

FRONTMATTER_RE = re.compile(r'\A(---\n)(.*?)(\n---\n)', re.DOTALL)
SORT_RE = re.compile(r'^sort:\s*\[(.*?)\]\s*$', re.MULTILINE)


def siblings(md_path: Path) -> set[str]:
    names = set()
    for p in md_path.parent.iterdir():
        if p == md_path:
            continue
        if p.is_file() and p.suffix == ".md":
            names.add(p.stem)
        elif p.is_dir():
            names.add(p.name)
    return names


def prune_file(md_path: Path) -> None:
    text = md_path.read_text(encoding="utf-8")
    fm = FRONTMATTER_RE.match(text)
    if not fm:
        return
    body = fm.group(2)
    m = SORT_RE.search(body)
    if not m:
        return
    present = siblings(md_path)
    tokens = [t.strip() for t in m.group(1).split(",")]
    kept = [t for t in tokens if t.strip('"').strip("'") in present]
    if kept == tokens:
        return
    new_list = "[" + ", ".join(kept) + "]"
    new_body = body[: m.start()] + "sort: " + new_list + body[m.end():]
    new_text = text[: fm.start()] + fm.group(1) + new_body + fm.group(3) + text[fm.end():]
    md_path.write_text(new_text, encoding="utf-8")
    dropped = [t for t in tokens if t not in kept]
    print(f"prune-sort-lists: {md_path}: dropped {', '.join(dropped)}")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    starter_dir = Path(sys.argv[1])
    for md in starter_dir.rglob("*.md"):
        prune_file(md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
