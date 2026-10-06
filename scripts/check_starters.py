#!/usr/bin/env python3
"""Validate starters against the contract in starters/README.md.

Run through scripts/check-starters.sh, which documents the checks.
"""
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
STARTERS = ROOT / "starters"

MAX_SITE_BYTES = 25 * 1024 * 1024
POSTER_SIZE = (1600, 1000)
ID_RE = re.compile(r"^[a-z0-9-]+$")
SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
# BCP 47, deliberately loose: language, optional script/region/variants.
LANG_RE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
TEXT_SUFFIXES = {".md", ".toml", ".json", ".css", ".html", ".txt", ".js", ".sh"}
# .moss/data holds per-site records; only redirects.json is source.
FORBIDDEN_RE = re.compile(
    r"^((\.moss/(build[^/]*|cache|identity|keys)|\.moss/state\.toml|\.claude|\.cursor)(/|$)"
    r"|\.moss/data/(?!redirects\.json$))"
)
FIELDS = {
    "schema_version": int, "id": str, "version": str, "name": str, "line": str,
    "credit": str, "language": str, "min_moss_version": str, "order": int,
    "tour": list,
}


def check_manifest(sid, starter, errors):
    mpath = starter / "manifest.json"
    if not mpath.is_file():
        errors.append("manifest.json is missing")
        return None
    try:
        m = json.loads(mpath.read_text(encoding="utf-8"))
    except ValueError as e:
        errors.append(f"manifest.json is not valid JSON: {e}")
        return None
    if not isinstance(m, dict):
        errors.append("manifest.json must be a JSON object")
        return None
    for key, typ in FIELDS.items():
        if key not in m:
            errors.append(f"manifest: missing field '{key}'")
        elif not isinstance(m[key], typ) or isinstance(m[key], bool):
            errors.append(f"manifest: '{key}' must be {typ.__name__}")
    if errors:
        return None
    if m["schema_version"] != 1:
        errors.append("manifest: schema_version must be 1")
    if not ID_RE.match(m["id"]):
        errors.append("manifest: id must match [a-z0-9-]+")
    if m["id"] != sid:
        errors.append(f"manifest: id '{m['id']}' must equal the folder name '{sid}'")
    if (ROOT / "plugins" / sid).exists():
        errors.append(f"a starter and a plugin may not share an id: plugins/{sid}/ exists")
    for key in ("version", "min_moss_version"):
        if not SEMVER_RE.match(m[key]):
            errors.append(f"manifest: {key} '{m[key]}' is not semver (x.y.z)")
    for key in ("name", "line", "credit"):
        if not m[key].strip():
            errors.append(f"manifest: '{key}' is empty")
    if not LANG_RE.match(m["language"]):
        errors.append(f"manifest: language '{m['language']}' is not a BCP 47 tag")
    if "demo_url" in m:
        demo = m["demo_url"]
        u = urlparse(demo) if isinstance(demo, str) else None
        if (u is None or u.scheme != "https" or not u.hostname or u.username is not None
                or u.password is not None or any(c.isspace() for c in demo)):
            errors.append("manifest: demo_url must be an absolute https:// URL without credentials")
    tour = m["tour"]
    if not tour:
        errors.append("manifest: tour is empty")
    seen = set()
    for i, stop in enumerate(tour):
        if (not isinstance(stop, dict) or not isinstance(stop.get("label"), str)
                or not stop["label"].strip() or not isinstance(stop.get("path"), str)):
            errors.append(f"manifest: tour[{i}] needs a non-empty string 'label' and a string 'path'")
            continue
        p = stop["path"]
        if (not p.startswith("/") or p.startswith("//") or "?" in p or "#" in p
                or any(c.isspace() for c in p) or ".." in p.split("/")):
            errors.append(f"manifest: tour[{i}].path '{p}' must be a /-rooted URL path with no query, fragment, space or '..'")
        if p in seen:
            errors.append(f"manifest: tour path '{p}' listed twice")
        seen.add(p)
    return m


def jpeg_size(path):
    """Width and height from the first SOFn marker, or None if not a JPEG."""
    data = Path(path).read_bytes()
    if data[:2] != b"\xff\xd8":
        return None
    i = 2
    while i + 4 <= len(data):
        if data[i] != 0xFF:
            return None
        marker = data[i + 1]
        if marker == 0xFF:
            i += 1
            continue
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return (w, h)
        i += 2 + length
    return None


def check_posters(starter, errors):
    for name in ("home-light.jpg", "home-dark.jpg"):
        p = starter / "posters" / name
        if not p.is_file():
            errors.append(f"posters/{name} is missing")
            continue
        size = jpeg_size(p)
        if size is None:
            errors.append(f"posters/{name} is not a JPEG")
        elif size != POSTER_SIZE:
            errors.append(f"posters/{name} is {size[0]}x{size[1]}, must be {POSTER_SIZE[0]}x{POSTER_SIZE[1]}")


def check_site(site, errors):
    if not site.is_dir():
        errors.append("site/ is missing")
        return
    total = 0
    for dirpath, dirnames, filenames in os.walk(site):
        rel_dir = Path(dirpath).relative_to(site).as_posix()
        for name in list(dirnames) + filenames:
            rel = name if rel_dir == "." else f"{rel_dir}/{name}"
            if FORBIDDEN_RE.match(rel):
                errors.append(f"site/{rel}: forbidden path (build output, identity or tooling state)")
                if name in dirnames:
                    dirnames.remove(name)  # report the folder once, not its contents
        filenames = [n for n in filenames if not FORBIDDEN_RE.match(f"{rel_dir}/{n}".removeprefix("./"))]
        for name in filenames:
            if name == ".DS_Store":
                continue
            p = Path(dirpath) / name
            total += p.stat().st_size
            if p.suffix.lower() in TEXT_SUFFIXES and p.stat().st_size < 2_000_000:
                text = p.read_text(encoding="utf-8", errors="replace")
                if re.search(r"(?m)^uid:", text):
                    errors.append(f"site/{p.relative_to(site).as_posix()}: carries a uid: line (minted fresh by each user's first build)")
    if total >= MAX_SITE_BYTES:
        errors.append(f"site/ is {total / 1048576:.1f} MB, must be under 25 MB")
    homes = [p for p in site.glob("*.md")
             if re.search(r"(?m)^home:\s*true\s*$", frontmatter(p))]
    if not homes:
        errors.append("site/: no top-level .md file carries `home: true` in its frontmatter")
    if not (site / ".moss" / "STARTER.md").is_file():
        errors.append("site/.moss/STARTER.md is missing")
    config = site / ".moss" / "config.toml"
    if config.is_file():
        for n, line in enumerate(config.read_text(encoding="utf-8").splitlines(), 1):
            if re.match(r"\s*(domain|site_id)\s*=", line) or re.match(r"\s*\[channels\.", line):
                errors.append(f"site/.moss/config.toml:{n}: deploy/identity key must not ship ({line.strip()})")


def frontmatter(path):
    text = path.read_text(encoding="utf-8", errors="replace")
    m = re.match(r"\A---\n(.*?)\n---\n", text, re.DOTALL)
    return m.group(1) if m else ""


def tour_target(out, url_path):
    rel = unquote(url_path).strip("/")
    d = out / rel if rel else out
    return d / "index.html"


def check_build(moss, sid, starter, manifest, errors):
    scratch = Path(tempfile.mkdtemp(prefix=f"starter-{sid}-"))
    try:
        copy = scratch / "site"
        shutil.copytree(starter / "site", copy)
        r = subprocess.run([moss, "build", str(copy), "--strict"],
                           capture_output=True, text=True)
        if r.returncode != 0:
            tail = (r.stdout + r.stderr).strip().splitlines()[-8:]
            errors.append("moss build --strict failed:\n    " + "\n    ".join(tail))
            return
        out = None
        for cand in (".moss/build.nosync/current", ".moss/build/current"):
            if (copy / cand).is_dir():
                out = copy / cand
                break
        if out is None:
            errors.append("moss build produced no .moss/build*/current directory")
            return
        for stop in manifest["tour"]:
            if not tour_target(out, stop["path"]).is_file():
                errors.append(f"tour path {stop['path']} ('{stop['label']}') is not in the built site")
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def semver_tuple(v):
    return tuple(int(x) for x in v.split("."))


def check_pin(ids):
    """The pinned preview moss must be new enough for every starter."""
    pin_path = STARTERS / "moss.json"
    if not pin_path.is_file():
        return ["starters/moss.json is missing"]
    pin = json.loads(pin_path.read_text(encoding="utf-8"))
    if not SEMVER_RE.match(str(pin.get("version", ""))) or not re.match(r"^[0-9a-f]{64}$", str(pin.get("sha256", ""))):
        return ["starters/moss.json needs a semver 'version' and a 64-hex 'sha256'"]
    errors = []
    for sid in ids:
        mpath = STARTERS / sid / "manifest.json"
        if not mpath.is_file():
            continue
        try:
            low = json.loads(mpath.read_text(encoding="utf-8"))["min_moss_version"]
            if SEMVER_RE.match(low) and semver_tuple(pin["version"]) < semver_tuple(low):
                errors.append(f"starters/moss.json pins moss {pin['version']}, below {sid}'s min_moss_version {low}")
        except (ValueError, KeyError):
            pass  # check_manifest reports a broken manifest
    return errors


def main(argv):
    site_only = "--site-only" in argv
    argv = [a for a in argv if a != "--site-only"]
    if STARTERS.is_dir():
        ids = argv or sorted(p.name for p in STARTERS.iterdir() if p.is_dir())
    else:
        ids = []
    if not ids:
        print("check-starters: no starters found", file=sys.stderr)
        return 1
    moss = os.environ.get("MOSS")
    failed = 0
    if not site_only:
        pin_errors = check_pin(ids)
        if pin_errors:
            failed += 1
            print("check-starters: preview moss pin: FAILED", file=sys.stderr)
            for e in pin_errors:
                print(f"  - {e}", file=sys.stderr)
    for sid in ids:
        starter = STARTERS / sid
        errors = []
        if not starter.is_dir():
            errors.append("no such starter")
        else:
            manifest = None if site_only else check_manifest(sid, starter, errors)
            if not site_only:
                check_posters(starter, errors)
            check_site(starter / "site", errors)
            if moss and manifest and not errors:
                check_build(moss, sid, starter, manifest, errors)
        if errors:
            failed += 1
            print(f"check-starters: {sid}: FAILED", file=sys.stderr)
            for e in errors:
                print(f"  - {e}", file=sys.stderr)
        else:
            print(f"check-starters: {sid}: ok" + (" (built --strict, tour resolves)" if moss else ""))
    if failed:
        print("check-starters: FAILED", file=sys.stderr)
        return 1
    print("check-starters: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
