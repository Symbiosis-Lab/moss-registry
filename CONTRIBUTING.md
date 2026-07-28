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

A plugin is a TypeScript package bundled into one IIFE that moss runs in a
sandboxed QuickJS engine. It talks to moss only through
[`@symbiosis-lab/moss-api`](https://www.npmjs.com/package/@symbiosis-lab/moss-api).

Start by copying the closest existing plugin — [`github`](./plugins/github) (a `deploy`
plugin) or [`matters`](./plugins/matters) (`syndicate` + `import` + `login`) — and
adjusting it. A plugin directory looks like:

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

## Submitting

1. Bump `version` in **both** `package.json` and `assets/manifest.json` (CI
   rejects a mismatch), and add a `CHANGELOG.md` entry.
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
  Dependencies are bundled into the artifact and are the hardest part to review,
  so adding one needs justification in the PR.
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
