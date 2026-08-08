# Sideloading the OnionPress plugin for a real test

The plugin ships as a bundle in `dist/` (`manifest.json` + `main.bundle.js` +
`icon.svg`). To test it against a real, running OnionPress receiver without
publishing it, symlink the built `dist/` into a vault's plugin directory.

## 1. Build the bundle

```bash
cd plugins/onionpress
pnpm run build          # → dist/manifest.json, dist/main.bundle.js, dist/icon.svg
```

## 2. Symlink dist/ into your vault

```bash
# <repo>  = this monorepo checkout
# <vault> = the moss folder you Publish
ln -s <repo>/plugins/onionpress/dist <vault>/.moss/plugins/onionpress
```

**Use a symlink, not a copy.** moss's bundled-plugin auto-updater
(`src-tauri/src/plugins/bundled.rs`) **skips any plugin directory that is a
symlink** ("respecting developer setup" — verified: `target_dir.is_symlink()` →
skip). A real directory would get reconciled against the binary's embedded copy
and could be clobbered; a symlink is left alone, so your dev build always wins.

## 3. Start OnionPress, then Publish

Start OnionPress on the same machine so its receiver is listening on loopback
(`8080`, or `18080`/`28080`/… for additional multi-user installs). Then in moss:

- Right-click the folder → **Publish**.

Because `onionpress` is the only `deploy`-capable plugin installed, moss selects
it automatically — the manifest declares `"capabilities": ["deploy"]` and no
`domain`, so it acts as the folder's deployer with no extra configuration.

On success you get a "Published to your onion site" toast with the `.onion` URL,
and moss records that URL as the site's `site_url`.

## Troubleshooting

- **"Start OnionPress first" toast** — no receiver answered `GET
  /status` on any probed port. Confirm OnionPress is running and its receiver is
  bound to `127.0.0.1:8080` (or one of `18080/28080/38080/48080`).
- **"Run a build first"** — `.moss/build/current` is missing. Preview or build
  the folder once so the generation symlink exists, then Publish.
