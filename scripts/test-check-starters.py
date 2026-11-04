#!/usr/bin/env python3
"""Test check_starters.py's rule for plugins a starter carries.

A starter may carry plugins under site/.moss/plugins/<id>/ only when its
manifest's `plugins` list declares exactly those ids, and only a starter that
declares plugins is built with --allow-plugins. Each case runs main() against
a throwaway starters/ tree, with a stand-in moss that records its arguments.

Run directly: python3 scripts/test-check-starters.py
"""
import contextlib
import importlib.util
import io
import json
import os
import shutil
import struct
import sys
import tempfile
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "check_starters", Path(__file__).parent / "check_starters.py"
)
cs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cs)

# Just enough JPEG for jpeg_size(): SOI, then an SOF0 segment carrying 1600x1000.
POSTER = b"\xff\xd8\xff\xc0\x00\x11\x08" + struct.pack(">HH", 1000, 1600) + b"\x00" * 12

FAKE_MOSS = """#!/bin/sh
echo "$@" > "$ARGS_FILE"
mkdir -p "$2/.moss/build/current"
echo ok > "$2/.moss/build/current/index.html"
"""


def make_starter(root: Path, declared, carried):
    starter = root / "starters" / "demo"
    (starter / "posters").mkdir(parents=True)
    for name in ("home-light.jpg", "home-dark.jpg"):
        (starter / "posters" / name).write_bytes(POSTER)
    site = starter / "site"
    (site / ".moss").mkdir(parents=True)
    (site / "index.md").write_text("---\nhome: true\n---\nHello.\n")
    (site / ".moss" / "STARTER.md").write_text("Notes.\n")
    for pid in carried:
        (site / ".moss" / "plugins" / pid).mkdir(parents=True)
        (site / ".moss" / "plugins" / pid / "manifest.json").write_text("{}\n")
    manifest = {
        "schema_version": 1, "id": "demo", "version": "1.0.0", "name": "Demo",
        "line": "A demo.", "credit": "Filled with nothing.", "language": "en",
        "min_moss_version": "0.1.0", "order": 1, "tour": [{"label": "Home", "path": "/"}],
    }
    if declared is not None:
        manifest["plugins"] = declared
    (starter / "manifest.json").write_text(json.dumps(manifest))
    (root / "starters" / "moss.json").write_text(json.dumps({"version": "9.9.9", "sha256": "0" * 64}))


def run_case(declared, carried):
    """Returns (exit code, stderr, the arguments moss was called with or None)."""
    tmp = Path(tempfile.mkdtemp(prefix="test-check-starters-"))
    try:
        make_starter(tmp, declared, carried)
        moss = tmp / "moss"
        moss.write_text(FAKE_MOSS)
        moss.chmod(0o755)
        args_file = tmp / "args"
        cs.ROOT, cs.STARTERS = tmp, tmp / "starters"
        os.environ["MOSS"], os.environ["ARGS_FILE"] = str(moss), str(args_file)
        err = io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            code = cs.main(["demo"])
        args = args_file.read_text().split() if args_file.exists() else None
        return code, err.getvalue(), args
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


failures = []


def expect(name, cond, detail=""):
    if not cond:
        failures.append(f"{name}: {detail}")


code, err, args = run_case(None, [])
expect("no plugins passes", code == 0, err)
expect("no plugins builds without --allow-plugins", args is not None and "--allow-plugins" not in args, args)

code, err, args = run_case(None, ["board"])
expect("undeclared plugin fails", code == 1, err)
expect("undeclared plugin is named", "site/.moss/plugins/board/ is carried" in err, err)
expect("undeclared plugin is not built", args is None, args)

code, err, args = run_case(["board"], [])
expect("declared but missing plugin fails", code == 1, err)
expect("declared but missing plugin is named", "declares plugin 'board'" in err, err)

code, err, args = run_case("board", ["board"])
expect("plugins must be a list", code == 1 and "plugins must be a non-empty list" in err, err)

code, err, args = run_case(["board"], ["board"])
expect("declared and carried passes", code == 0, err)
expect("declared plugins build with --allow-plugins", args is not None and "--allow-plugins" in args, args)

if failures:
    print("test-check-starters: FAILED", file=sys.stderr)
    for f in failures:
        print(f"  - {f}", file=sys.stderr)
    sys.exit(1)
print("test-check-starters: OK")
