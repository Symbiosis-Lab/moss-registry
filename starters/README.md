# Starters

A starter is a complete small site that a person's new moss site begins as. Instead of an empty folder, they choose one of these, and moss copies it into their folder: real pages, a real theme, a real map, filled with words and pictures that are free to use, so they can see what a finished site looks like and then replace it page by page with their own.

Each starter is a folder here. This file is the contract: what a starter contains, what every starter promises, how moss uses it, and how to add or update one.

## Layout

```
starters/
  <id>/
    manifest.json            what the picker shows and what moss checks
    posters/home-light.jpg   1600x1000 JPEG, the first viewport of the built home page, light scheme
    posters/home-dark.jpg    the same, dark scheme
    site/                    exactly the folder a user's new site starts as
    .cut                     optional registry tooling: which paths of a fuller site make up site/
    fixups.sh                optional registry tooling: edits the cut cannot infer
    README.md                for maintainers: what it is, what fills it and why, and what was cut if it was cut
```

`site/` is the product. The app builds it, previews it and copies it into a new folder byte for byte, so whatever is in `site/` is what the user gets, including `.moss/config.toml`, the theme, and `.moss/STARTER.md` (notes to the user on making the starter theirs). Everything beside `site/` is for the people who maintain the registry and never reaches a user.

`site/` is the whole product: the registry neither requires nor knows about any fuller version of it. A starter can be written directly in `site/`, or cut from a fuller site its author keeps elsewhere, keeping enough of each kind of page for every feature to show. `.cut`, `fixups.sh` and `scripts/cut-starter.sh` exist for that second case and are optional: `.cut` lists the paths of the fuller site, and `cut-starter.sh` rebuilds `site/` from them, so the starter can be refreshed when the fuller site improves without anyone copying files by hand.

## `manifest.json`

All fields are required unless marked. Consumers ignore fields they do not know.

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | integer | `1` |
| `id` | string | The folder name. Lowercase letters, digits and `-`. It may not equal the id of a plugin. |
| `version` | string | Semver, starting at `"1.0.0"`. Any change to `site/` or `posters/` must raise it; CI checks. |
| `name` | string | Display name in the picker. |
| `line` | string | One sentence: what kind of site this is, and for whom. |
| `credit` | string | One sentence: whose words and pictures fill it. |
| `language` | string | BCP 47 tag of the site's language, such as `en` or `zh-Hant`. |
| `min_moss_version` | string | The lowest moss release the starter is known to build clean on (`--strict`). |
| `order` | integer | The picker shows starters in ascending `order`. |
| `demo_url` | string, optional | An absolute `https://` URL of a live demo the author chooses to keep. It can be anything: the starter itself deployed somewhere, or a fuller site it was cut from. The registry does not host it, check it or depend on it. |
| `tour` | array | 3 to 5 stops, each `{ "label", "path" }`. `path` is a `/`-rooted URL path to a page that exists in the built site, percent-encoded as moss writes its links (so a Chinese folder name appears as `%E7%95%AB`). The tour is what a reader is shown to see what the starter can do: the home page, a typical page, a series with previous and next, a map. |

## What every `site/` guarantees

`scripts/check-starters.sh` enforces all of these, and CI runs it on every pull request that touches a starter.

- Its home page file carries `home: true` in its frontmatter.
- No file carries a `uid:` line. moss writes those into any file it builds, and each user's first build mints their own.
- None of these paths exists: `.moss/state.toml`, `.moss/identity`, `.moss/keys`, `.moss/build*`, `.moss/cache`, `.claude/`, `.cursor/`, and nothing under `.moss/data/` except `redirects.json`. They are build output or belong to one person's site.
- `.moss/config.toml` has no `domain`, no `site_id` and no `[channels.*]`: a starter has no address and publishes nowhere.
- It is under 25 MB in total.
- `.moss/STARTER.md` exists. It lives in `.moss/` so it is never built as a page.

Beside that, the manifest must validate, `id` must equal the folder name, both posters must exist and be exactly 1600x1000 JPEG, and every tour path must be well formed. With a moss binary available the check also builds a scratch copy of each starter with `--strict` and requires every tour path to be in the built site:

```bash
MOSS=/path/to/moss scripts/check-starters.sh
```

Never build inside the repository: moss writes `uid:` lines and build folders into whatever it builds. The scripts copy to a scratch folder for you.

The words and pictures in a starter must be public domain or openly licensed, and the basis must be stated: in the site's About page, or in the starter's README.

## How moss uses a starter

The desktop app bundles every starter's `manifest.json` and posters, so the picker works offline. When a reader chooses a starter, the app downloads that starter's source zip, checks its sha256, and copies `site/` into the new folder. For a live preview of a starter it downloads the preview zip, checks its sha256 and serves the built site from a local copy. The index entries that point at these downloads are described below; clients that predate them skip those entries.

`scripts/pack-starters` makes what is downloaded, into `dist/` (gitignored):

| File | What it holds |
|---|---|
| `dist/starters/<id>-<version>.zip` | The source: `manifest.json`, `posters/` and `site/`, at the zip root and nothing else. |
| `dist/starters/<id>-<version>-preview.zip` | The built site: the contents of the build output at the zip root (`index.html`, `_moss/`, `assets/`, …), without `_moss/og/`. Those are the share-card images moss draws for other sites' link previews; no page shows one, and they were a third of the largest preview. Made only when `MOSS` points at a moss binary; it is built from a scratch copy with `--strict`. |
| `dist/starters/<id>-<version>.json` | Which moss built the preview and the sha256 of both zips. Made only with the preview. It is the third asset of the release. |
| `dist/starters/<id>/` | The unpacked source, for inspection. |
| `dist/starters/index-entries.json` | One registry-index entry per starter, described below. |

Both zips are deterministic: entries sorted, fixed timestamps and permissions, so packing the same starter twice gives the same bytes and the same sha256. The script prints each zip's name, sha256 and size.

### The index entry

A published starter is listed in the registry index as an entry with `"type": "starter"`, beside the plugin entries, with the same `download_url`, `sha256`, `size_bytes` and `min_moss_version` fields. Clients skip entry types they do not know, so today's moss ignores these entries.

| Field | Meaning |
|---|---|
| `type` | `"starter"` |
| `id`, `version` | From the manifest. |
| `display_name` | The manifest's `name`. |
| `description` | The manifest's `line`. |
| `credit`, `language`, `order`, `min_moss_version`, `tour` | From the manifest. |
| `demo_url` | From the manifest when it has one and it is a valid `https://` URL; otherwise the key is absent. |
| `download_url`, `sha256`, `size_bytes` | The source zip. |
| `preview_url`, `preview_sha256`, `preview_size_bytes` | The preview zip. Omitted when it was not built. |
| `preview_moss_version` | The moss release that built the preview (what `moss --version` reports). Omitted with the other preview fields. |

URLs are `<base>/starter-<id>-v<version>/<zip name>`. The base is `https://github.com/Symbiosis-Lab/moss-registry/releases/download` unless `--base-url` says otherwise, so each starter version is a release tagged `starter-<id>-v<version>` whose assets are its two zips.

### How a starter is released and indexed

When a merge to `main` carries a starter whose tag `starter-<id>-v<version>` does not exist yet, the publish workflow's `starters` job packs it and creates that release with three assets: the source zip, the preview zip, and `<id>-<version>.json`, a small file naming the moss release that built the preview (`preview_moss_version`) and the sha256 of each zip it describes. Then the index is rebuilt from the releases that exist: for each starter id it lists the highest published version, with every field read from the release itself. The manifest fields come from `manifest.json` inside the source zip, the hashes and sizes from the downloaded assets, the URLs from the release. If the `.json` is missing or its hashes disagree with the zips, the entry simply has no preview fields. A release without its source zip, or whose manifest cannot fill an entry, is skipped with a warning.

Previews are built by the moss release pinned in [`moss.json`](moss.json): its version and the sha256 of its Linux binary. `scripts/fetch-moss.sh` downloads it and refuses a binary whose hash differs, and `check-starters.sh` refuses a pin lower than any starter's `min_moss_version`. Pull requests build and pack every starter with the same binary, so the Linux path is proven before merge. Moving the pin is an ordinary pull request; it does not rebuild starters already released.

A released version is final. An existing tag is never touched, so fixing a starter always means raising its `version`.

A starter's failure never holds back the rest of the registry: the starters job is separate from the plugin release job, and the index and `revoked.json` deploy whether or not it succeeded.

## Adding a starter

1. Write the starter's `site/`: a real small site, filled with words and pictures that are public domain or openly licensed, with the basis stated. Or, if you keep a fuller site elsewhere, cut it down (steps 2 and 3 below).
2. Optional, to cut from a fuller site: write `starters/<id>/.cut`, the paths of the fuller site that make up the starter, one per line, with a comment on why each group is there. Keep enough of every section for its feature to show (a series needs two pages for previous and next; a map needs located pages) and no more.
3. Optional, to cut from a fuller site: run `scripts/cut-starter.sh <path-to-the-fuller-site> <id>`. It writes `starters/<id>/site/`, strips `uid:` lines and deploy keys, prunes the gazetteer and `sort:` lists to the pages kept, and brings every image under the size budget. If a correction cannot be inferred, put it in `starters/<id>/fixups.sh`: a small, idempotent script run with the working directory at `site/`.
4. Write `site/.moss/STARTER.md` (what to replace, how it is put together, what belongs to whom) and `starters/<id>/README.md`.
5. Write `manifest.json`. Choose the tour by looking at the built site, then run `MOSS=… scripts/check-starters.sh` to confirm every stop resolves. Add `demo_url` if you keep a live demo.
6. Make the posters: `MOSS=… scripts/make-posters.sh <id>`, and look at them.
7. Run `MOSS=… scripts/check-starters.sh` once more, then open a pull request.

## Updating a starter

Edit `site/` directly, or, for a starter cut from a fuller site, re-run `scripts/cut-starter.sh` against the improved fuller site (a re-cut with nothing changed upstream produces no diff, so a diff after a re-cut is always a real change). Either way, raise `version` in `manifest.json`, and if the home page changed run `scripts/make-posters.sh` again. CI refuses a pull request that changes `site/` or `posters/` without raising the starter's `version`.

A released version is final, as it is for plugins: never replace one in place, publish the next.

## The scripts

All of them live in `scripts/` and can be re-run safely.

| Script | What it does |
|---|---|
| `cut-starter.sh <full-site> <id>` | Optional, for starters cut from a fuller site: rebuilds `starters/<id>/site/` from it and `.cut`. Keeps `site/.moss/STARTER.md` and `site/.moss/templates/` across a re-cut, because they belong to the starter. |
| `check-starters.sh [<id> …]` | Validates starters against this contract, and the preview moss pin against their `min_moss_version`. |
| `fetch-moss.sh [<path>]` | Downloads the moss pinned in `moss.json` and verifies its sha256. |
| `make-posters.sh <id>` | Builds a scratch copy, screenshots the home page light and dark at 1600x1000, writes the two JPEGs. Needs `MOSS`, Playwright with Chromium (`NODE_PATH` pointing at a `node_modules` that has it) and Pillow. |
| `pack-starters [<id> …]` | Writes the zips and the index entries described above. |
| `check-starter-versions.sh <base-ref>` | Fails if `site/` or `posters/` changed without a `version` bump since `<base-ref>`. |
| `compress-images.py`, `prune-places.py`, `prune-sort-lists.py` | Steps of the cut. `test-compress-images.py` tests the first. |

## The starters

| Starter | Name | Language | What it is |
|---|---|---|---|
| [`essays`](essays/) | Essays | en | A writer's own site: essays, talks and an about page. |
| [`organisation`](organisation/) | Organisation | en | A society's site: a course of reading, local circles on a map, a calendar, notices. |
| [`bada-shanren`](bada-shanren/) | Vertical | zh-Hant | A vertical Chinese site, read right to left: writings, calligraphy, paintings. |
