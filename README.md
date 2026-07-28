# moss-registry

> Plugins and themes for [moss](https://mosspub.com) — and the registry that
> distributes them.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

This repository holds the source of everything moss can install — plugins and
themes, first-party and community alike — plus the registry metadata the app
reads to offer them. **Pull requests are welcome** — see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Plugins and themes

Two kinds of package live here, and the difference is worth stating plainly
because it decides how each is reviewed:

- A **plugin** *does* something. It is code moss executes on your machine, in a
  sandboxed JavaScript engine with access to host functions — the network, your
  project's files, and (when declared) running native programs. Plugins
  accumulate: several can be active at once, each activated by the capabilities
  it declares.
- A **theme** *looks like* something. It is presentation the site build reads —
  CSS and assets, never code moss runs. Themes are exclusive: exactly one is
  active, chosen by a pointer in your project's config.

The registry is the layer they share: submit, review, release, index, install,
update, revoke. It does not care which kind it is moving.

The practical rule: **if it needs to run code, it is a plugin; if it only
changes how things look, it is a theme.** A theme that wants logic is really a
plugin (moss has a presentation hook for exactly that).

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
[`symbiosis-lab.github.io/moss-registry/index.json`](https://symbiosis-lab.github.io/moss-registry/index.json)
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
| [github](./plugins/github) | `@symbiosis-lab/moss-plugin-github` | Publish moss sites to GitHub Pages |
| [matters](./plugins/matters) | `@symbiosis-lab/moss-plugin-matters` | Publish posts to matters.town |

## In development (WIP)

Functional but not yet recommended for general use.

| Plugin | Package | Purpose |
|---|---|---|
| [douban](./WIP/douban) | `@symbiosis-lab/moss-plugin-douban` | Import and cross-post content from douban |
| [linkedin](./WIP/linkedin) | `@symbiosis-lab/moss-plugin-linkedin` | Cross-post to LinkedIn |
| [substack](./WIP/substack) | `@symbiosis-lab/moss-plugin-substack` | Cross-post to Substack |
| [x](./WIP/x) | `@symbiosis-lab/moss-plugin-x` | Cross-post to X |
| [xiaohongshu](./WIP/xiaohongshu) | `@symbiosis-lab/moss-plugin-xiaohongshu` | Cross-post to Xiaohongshu |

`terrarium` is an internal harness for exercising moss's plugin UI surfaces, not
a user-facing plugin.

Archived (no longer maintained): `astro`, `eleventy`, `gatsby`, `hugo`, `jekyll`
— see [`archive/`](./archive).

## Repository layout

```
plugins/<id>/        a published plugin
  src/               TypeScript source — this is what reviewers read
  assets/            manifest.json + icon, copied verbatim into the bundle
  package.json       standalone; pins @symbiosis-lab/moss-api, own lockfile
  dist/              build output — gitignored; CI builds it from src/
themes/<id>/         a published theme (planned): style.css, assets, manifest,
                     preview.png — no executable entry point
registry/
  revoked.json       versions moss must refuse to load (the kill switch)
WIP/, archive/       not published to the registry
terrarium/           dev harness for moss's plugin UI surfaces; not published
```

`plugins/` holds exactly what the registry publishes — that is why `WIP/`,
`archive/` and `terrarium/` sit outside it rather than being excluded by a list
somewhere. CI selects work by the same rule, and so does the publisher: a
directory under `plugins/` gets a release and an index entry, and anything
elsewhere in the tree does not.

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
