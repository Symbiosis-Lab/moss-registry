# moss-registry

> Plugins and themes for [moss](https://mosspub.com) — and the registry that
> distributes them.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

This repository holds the source of everything moss can install — plugins and
themes, first-party and community alike — plus the registry metadata the app
reads to offer them. **Pull requests are welcome** — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Plugins and themes

Two kinds of package live here. The difference is not a label — it decides
whether moss ever executes your code, which is why it also decides how you are
reviewed.

- A **plugin** *does* something. It is code moss runs on your machine, in a
  sandboxed JavaScript engine with access to host functions — the network, your
  project's files, and (when declared) native programs.
- A **theme** *looks like* something. It is presentation the site build reads —
  CSS and assets. moss never executes it.

The practical rule: **if it needs to run code, it is a plugin; if it only
changes how things look, it is a theme.** A theme that wants logic is really a
plugin, and moss has a presentation hook for exactly that.

### What actually differs

|  | plugin | theme |
|---|---|---|
| lives in | `plugins/<id>/` | `themes/<id>/` |
| moss executes it | yes, sandboxed | never |
| how many are active | many at once, each by the capabilities it declares | exactly one, chosen by a pointer in your config |
| installs to | `.moss/plugins/<id>/` | `.moss/themes/<id>/` |
| review reads | source, dependencies, host capabilities | CSS and assets |
| revoking it | stops it loading on every machine that refreshes | cannot recall a site already published with it |

That last row is an honest asymmetry rather than an oversight. Revocation is a
kill switch for code that runs; a theme's output has already left for someone's
website by the time anyone could revoke it. It is why v1 themes are CSS and
assets with no `script.js` — the thing that makes them un-revokable is also the
thing that makes them safe enough not to need it.

### How the difference is recorded

**The directory decides.** A package under `plugins/` is a plugin and one under
`themes/` is a theme; there is no separate switch to set and nothing to keep in
sync. Your `manifest.json` may restate it as `"type"`, because once the artifact
is a release zip the directory is no longer visible and moss should still be able
to tell what it is holding — but CI rejects a manifest whose `type` disagrees
with where it lives. Two declarations that can differ are worse than one.

That kind travels to moss as the `type` field on the package's index entry, and
**moss ignores entries whose `type` it does not recognise.** That rule is what
makes the schema genuinely theme-ready rather than theme-ready in principle: a
copy of moss shipped today keeps working unchanged on the day the first theme
appears in the index, instead of choking on an entry it was never taught about.

The registry itself is the layer the two kinds share — submit, review, release,
index, install, update, revoke — and none of it cares which kind is moving.

> **Status:** plugins are live; themes are designed but not yet published. There
> is no `themes/` directory here yet, and CI has no theme rules. The `type` field
> exists in the index from day one anyway, for the compatibility reason above.

> Previously this repo was a read-only mirror, generated from the moss monorepo
> and force-pushed on each sync — which is why older docs said PRs could not be
> merged. That is no longer true: this repo is now the source of truth for
> plugin code.

## How distribution works

A plugin is a TypeScript package bundled by esbuild into a single IIFE that moss
loads in a sandboxed QuickJS engine. End users do **not** install plugins from
npm.

1. You open a PR adding or updating a plugin directory.
2. CI validates it and builds the bundle from your source.
3. A maintainer reviews that source and merges.
4. On merge, CI packages `<id>-<version>.zip`, attaches it to a GitHub Release,
   and regenerates the registry index.
5. moss reads that index so users can install the plugin from the app, and shows
   an update badge when a newer version is published.

The index is served from a single pinned origin,
[`symbiosis-lab.org/moss-registry/index.json`](https://symbiosis-lab.org/moss-registry/index.json)
— see [`registry/`](registry/) for what it contains and how a package is retired.

Updates are never applied silently — the user chooses when to update. If a
version turns out to be harmful it can be revoked via
[`registry/revoked.json`](registry/revoked.json), which moss honours on its next
refresh.

The in-app catalog that consumes this index ships in an upcoming moss release.
Until then, a published plugin can be installed by unpacking its release zip into
a project's `.moss/plugins/<id>/`.

## Active plugins

| Plugin | Package | Purpose |
|---|---|---|
| github | `@symbiosis-lab/moss-plugin-github` | Publish moss sites to GitHub Pages |
| matters | `@symbiosis-lab/moss-plugin-matters` | Publish posts to matters.town |

Both are **first-party** — they ship bundled inside moss — and neither is a
special case here. Their source sits in `plugins/` like everyone else's, this
repository's CI builds it, and the release it publishes is the one moss
installs. Bundling only decides what a fresh moss starts with; the registry is
how a bundled plugin gets updated between moss releases.

They are the most installed plugins here and they run with the same host access
any plugin gets, so holding them to a weaker standard than a contributor's would
be exactly backwards. Read them, build them:

```bash
cd plugins/github && npm ci && npm run build
```

Their directories carry a `.generated` marker, because their source of truth is
the moss repository — moss copies them here on each release, with
`@symbiosis-lab/moss-api` pinned to a published version and a lockfile
committed so this repository can build them standalone. CI refuses a pull
request that edits a marked directory; send the change to moss instead.

## Repository layout

```
plugins/<id>/        a published plugin
  src/               TypeScript source — this is what reviewers read
  assets/            manifest.json + icon, copied verbatim into the bundle
  package.json       standalone; pins @symbiosis-lab/moss-api, own lockfile
  dist/              build output — gitignored; CI builds it from src/
  .generated         only on generated dirs — source of truth is moss
themes/<id>/         a published theme (planned): style.css, assets, manifest,
                     preview.png — no executable entry point
registry/
  revoked.json       versions moss must refuse to load (the kill switch)
```

Everything here is published, or is the metadata describing what is published.
Unfinished experiments, retired plugins and internal test harnesses used to live
here too, inherited from the days when this repository was a generated mirror of
moss's `plugins/` directory. They are back in moss now: this repository is
public and its contents are an offer to users, so anything nobody should install
does not belong in it.

`plugins/` holds exactly what the registry publishes, which is what lets CI and
the publisher both select work by the same rule — a directory under `plugins/`
gets validated, released and indexed, and nothing elsewhere in the tree does.

Installed packages land in different places, and neither overwrites work you
authored yourself: a plugin installs to `.moss/plugins/<id>/`, a theme to
`.moss/themes/<id>/`. Your own hand-written `.moss/theme/style.css` is yours
alone — moss never replaces it, and it wins over an installed theme.

`dist/` is never committed. The artifact users install is always built by CI from
the source in the pull request, so what a reviewer reads is what ships.

Each plugin is an independent package with its own `package.json` and
`package-lock.json` — there is no workspace, so a PR only ever touches its own
dependency tree.

## Building a plugin locally

```bash
cd plugins/<id>
npm ci
npm run build      # bundles src/ -> dist/main.bundle.js and copies assets
npm test
npm run dev        # rebuild on change, for live development against moss
```

## Stability

All plugins are 0.x and track the moss plugin API, which may change between
minor versions until 1.0. Each plugin has its own `CHANGELOG.md`; declare the
oldest moss you support with `min_moss_version` in your manifest.

## License

MIT — see [LICENSE](LICENSE). Contributions are accepted under the same license.
