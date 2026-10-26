# Contributing

Pull requests are welcome. This repo is the source of truth for moss plugins and
the registry that distributes them, so a merged PR is what publishes your plugin.

> This repository used to be a read-only mirror where PRs could not be merged.
> That restriction is gone; the patch-via-Discussion workflow it required is no
> longer necessary.

- **Bug reports**: open an [Issue](../../issues).
- **Questions / ideas**: use [Discussions](../../discussions).
- **Security**: see [SECURITY.md](SECURITY.md). Never file a public issue for a
  vulnerability.

## Building a plugin

A JavaScript plugin is a TypeScript package bundled into one IIFE that moss runs in a
sandboxed QuickJS engine. It talks to moss only through
[`@symbiosis-lab/moss-api`](https://www.npmjs.com/package/@symbiosis-lab/moss-api).

The closest working examples are the first-party plugins in this repository —
[`github`](./plugins/github) (a `deploy` plugin) and
[`matters`](./plugins/matters) (`syndicate` + `import` + `login`). Read them and
copy the shape; just don't *edit* them here, since they carry a `.generated`
marker and are copied in from moss on each release.

The SDK's own documentation is the reference for what a hook receives and
returns; everything below is what this repository additionally requires. A
plugin directory looks like:

```
plugins/<id>/
  package.json          name @symbiosis-lab/moss-plugin-<id>, standalone deps
  package-lock.json      committed
  src/main.ts           exports the hook functions your capabilities declare
  assets/
    manifest.json       the contract moss reads
    icon.svg
  dist/                 build output — gitignored; CI rebuilds it
  README.md             required — must include a "Network access" section
  CHANGELOG.md
```

`assets/manifest.json` must at minimum declare:

```json
{
  "name": "<id>",
  "version": "1.0.0",
  "entry": "main.bundle.js",
  "global_name": "<Id>Plugin",
  "capabilities": ["syndicate"],
  "min_moss_version": "0.8.0"
}
```

- `name` must equal the directory name: lowercase, `[a-z0-9-]`, 3–40 chars. It
  may not start with `moss-` and may not collide with an existing plugin.
- `global_name` must match the `--global-name` passed to esbuild in your
  `bundle` script, and `entry` must be the bundle filename it emits.
- `capabilities` are the hooks you implement (`process`, `generate`, `enhance`,
  `deploy`, `syndicate`, `import`, `login`).
- `min_moss_version` is the oldest moss you support — set it to the version you
  developed against.
- `requires` declares host capabilities that need granting. Today the only
  recognized value is `"execute_binary"` (running arbitrary native processes).

Your manifest is also the catalog copy. The index is generated from the manifest
inside your published zip — nothing about your plugin is written down a second
time, so there is nowhere for the two to drift apart. Worth filling in:

- `display_name` — what users see. Without it the catalog falls back to your id,
  so `matters` reads as "matters" rather than "Matters".
- `description` and `author` — shown on the tile.
- `icon` — published as its own release asset so the catalog can show it before
  anything is installed. Defaults to `icon.svg`.
- `repository` and `homepage` — links out from the tile, if you have them.

### Development loop

```bash
cd plugins/<id>
npm ci
npm run dev     # rebuilds dist/ on change
```

To try it in moss, point a project's plugin directory at your build — from a
moss project folder:

```bash
ln -s /path/to/moss-registry/plugins/<id>/dist ~/my-site/.moss/plugins/<id>
```

moss respects symlinked plugin directories, so your rebuilds land directly.
Reopen the folder in moss to pick up a changed bundle.

## Building a native plugin

A native plugin is a manifest plus a program moss downloads and runs, with no JavaScript. It declares what it does under `contributes.derivations` (a derivation turns one kind of file into another, such as PDF to text) and has no `entry`. The first use is `pdf-ocr`. A plugin is JavaScript or native, never both: CI refuses a package with an `entry` that also declares a downloaded program or has a `native/` directory.

```
plugins/<id>/
  assets/
    manifest.json        source manifest: artifacts have no url or sha256
    icon.svg             optional
  native/
    Cargo.toml           [package] version must equal the manifest version
    src/ ...             the program's source, with its lockfile
    build-darwin-arm64.sh   one script per declared platform
  README.md              required — must include a "Network access" section
```

Each `run.artifact` entry needs `kind: "download"`, a `platform` (today only `darwin-arm64`), an `archive_format` (`tar.gz` or `zip`) and an `executable`, the path of the program inside the archive (relative, no `..`). Write no `url` or `sha256`: on release CI builds the archive, then fills in the release URL and the archive's sha256 in the manifest it ships, because moss shows that sha256 to the user as part of what they consent to and runs only bytes that match it. If several derivations use the same platform they share one archive, so they share its `archive_format`.

The build-script contract is the only thing the registry knows about how your program is built:

- CI runs `bash native/build-<platform>.sh` with `native/` as the working directory, on a macOS runner for `darwin-arm64`. The script builds from source and packages the archive.
- It logs to stderr and prints the archive's path, absolute or relative to `native/`, as the last line of stdout.
- The archive is named `<id>-<version>-<platform>.<archive_format>`, for example `pdf-ocr-0.2.4-darwin-arm64.tar.gz`.
- Every declared `executable` must be in the archive as a regular file with an execute bit, and `<executable> --version` must exit 0.

You can try the whole pipeline locally on a matching machine: `scripts/pack-native-plugin plugins/<id> --out /tmp/out --repo Symbiosis-Lab/moss-registry` builds, checks and packages exactly what a release would contain, and uploads nothing.

Because a native program runs on users' machines with whatever access they have, review means reading the source under `native/` and every dependency in its lockfile, and the build script itself. The PR validator flags native plugins for that reason. Your build script runs in PR CI too, in a job with a read-only token and no secrets.

## Submitting

1. Bump `version` in **both** `package.json` and `assets/manifest.json` (CI
   rejects a mismatch), and add a `CHANGELOG.md` entry. A native plugin bumps
   `native/Cargo.toml` and `assets/manifest.json` instead.
2. Run `npm run build` and `npm run test:unit` locally (CI runs the unit
   scope — keep those tests free of browser, network, and moss-binary
   dependencies). Don't commit `dist/` — it is
   gitignored, and CI rebuilds it from your source so that what reviewers read
   is what ships.
3. Open a PR touching only your plugin's directory.

CI validates the manifest, the id and version rules, your README's Network
access section, and builds the bundle from your source. A maintainer then
reviews that source. Review is first-come-first-served and there is no promised
turnaround.

On merge, CI packages your plugin, publishes a GitHub Release, and adds it to
the registry index. There is no second publish step.

## Contributing a starter

A starter is a small, complete site a new moss site can begin as. The contract (layout, manifest, guarantees) is in [`starters/README.md`](starters/README.md); this is the short route through it.

1. Write the starter as a real small site: either directly in `starters/<id>/site/`, or as a fuller site you keep outside this repository and cut down.
2. Optional, to cut from a fuller site: add `starters/<id>/.cut` listing which paths of it make up the starter, then run `scripts/cut-starter.sh <path-to-the-fuller-site> <id>`. It writes `starters/<id>/site/` and removes everything that must not ship: `uid:` lines, deploy keys, build output.
3. Write `site/.moss/STARTER.md` (notes for the person making the starter theirs), a maintainer `README.md`, and `manifest.json`, with a tour of three to five pages that show what the starter can do.
4. Make the two posters with `scripts/make-posters.sh <id>` and look at them.
5. Run `MOSS=/path/to/moss scripts/check-starters.sh`. It validates the manifest, posters and guarantees, builds each starter with `--strict` and confirms every tour page exists. CI runs it too, with a pinned moss.
6. Open a PR touching only your starter's directory. After it merges, the publish workflow releases the new version as `starter-<id>-v<version>` and adds it to the index.

To change an existing starter, edit its `site/` (or re-cut it from its fuller site, if it has one), **raise `version` in its `manifest.json`**, and re-make the posters if the home page changed. CI rejects a PR that changes a starter's `site/` or `posters/` without raising `version`, for the same reason a plugin's version must move: a released version is final, and a changed starter is a new one.

**Licence.** Everything a starter is filled with, words and pictures alike, must be in the public domain or under an open licence that allows reuse and redistribution, because every user who picks the starter receives a copy. State the basis: in the site's About page, or in the starter's README, naming each source and why it is free to use. Material you cannot show the basis for does not go in.

## How changes land

Merging here publishes: a commit on `main` runs a workflow holding a token that
can cut releases and redeploy the index moss trusts. So `main` is protected, and
the rules apply to maintainers too — not as ceremony, but because an accidental
`git push` to `main` would otherwise *be* a publish.

- **Every change goes through a pull request.** No direct pushes, including
  from maintainers.
- **`all checks` must pass.** One check with a fixed name that stands for all
  the others, so the requirement does not have to guess at job names that vary
  per PR.
- **`main` cannot be force-pushed or deleted.** Its history is the record of
  what was reviewed.
- **Release tags cannot be moved or deleted.** They can only be created.

Approvals are not currently required, because there is one maintainer and
nobody can approve their own pull request. That becomes a required review the
moment a second maintainer exists; the pull request itself is what the rule is
buying today.

### Why tags are immutable

`<id>-v<version>` tags are the version record. CI reads them to check that your
version moved forward, and the publisher treats "does this tag exist" as the
question of whether something has already shipped. A movable tag would make both
answers rewritable — delete one and the next run re-cuts that version from
whatever `main` says now, quietly replacing bytes someone already installed.

So a released version is final. If one turns out to be broken or harmful, the
answer is to revoke it and publish a new version — never to replace it in place.
That is what [`registry/revoked.json`](registry/revoked.json) is for.

## Policies

These are the rules review enforces. A plugin runs with real access to the
author's machine, so they are not negotiable.

- **No obfuscated or minified-only source.** What reviewers read must be what CI
  builds.
- **No self-update or remote code loading.** Your plugin may not fetch and
  execute code at runtime; the version moss installed is the version that runs.
- **Declare your network use.** Your README needs a `## Network access` section
  listing every domain you contact and why. "None" is a fine answer.
- **Prefer zero runtime dependencies.** The moss-api SDK should be enough.
  Dependencies are bundled into the artifact and run with every capability the
  plugin holds, so adding one needs justification in the PR, and review reads
  the dependency's code as if it were yours. A lockfile diff is not a review of
  what it pulls in.
- **`execute_binary` requires declaration and justification.** It runs arbitrary
  native processes. Declare it in `requires` and explain in the PR why nothing
  weaker works. Reviewers may decline it.
- **Committed lockfile.** Dependency diffs are part of review.

## Stewardship

Maintainers may patch any plugin in this repo for security fixes or moss-api
migrations, preserving author attribution. If an author is unreachable after
three contact attempts, their plugin may be adopted or delisted so users are not
left on broken or unsafe code.

## License

This repo is MIT (see [LICENSE](LICENSE)). By opening a PR you agree your
contribution is licensed under it — inbound matches outbound. Only submit code
you have the right to license this way.
