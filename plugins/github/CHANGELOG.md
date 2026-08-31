# Changelog

## [Unreleased]

### Changed

- Publishing reports each step once, when it starts, instead of repeating the same line on a timer. The repetition existed to convince moss the plugin had not hung; moss now counts the work itself as being alive — a push or an upload it is running, and, while the repository form is open, the fact that the plugin is waiting on you. The panel says which one it is waiting for instead of showing a progress bar that never moves, and a repository form you close or leave alone is reported as cancelled rather than as a step that succeeded.
- Signing in happens before publishing, not in the middle of it. moss now asks the plugin whether your GitHub account is connected when you click Publish, and shows a "Sign in to GitHub" button in its own window if it is not — instead of the old behaviour, where a publish would start, reach the halfway point, and quietly wait for a sign-in behind a progress bar that said it was working.

- Losing your connection no longer signs you out of GitHub. Every Publish click checks the stored sign-in with GitHub first, and a check that could not reach GitHub at all — offline, or GitHub rate-limiting you — used to be read as "GitHub rejected you" and threw the sign-in away. It now tells the two apart, so publishing works again the moment you are back online rather than after signing in from scratch. Only GitHub actually refusing the sign-in clears it.

- Signing out now actually forgets the GitHub token. The plugin cleared it by storing an empty cookie set, which moss accepted and ignored, so the old token was still there on the next launch; it now calls `clearPluginCookies()`, and moss refuses the empty write rather than reporting a success that never happened.

- The plugin now marks itself as a preview in its manifest (`"preview": true`). It appears in moss's plugin catalog only for users who have turned on preview features — replacing the hidden-for-everyone list moss used to keep in its own binary. Sideloaded and already-installed copies stay visible and manageable either way.

- The plugin now declares `requires: ["execute_binary"]` in its manifest. moss has begun refusing privileged host capabilities that a plugin has not declared, and this plugin runs `git` to publish. Without the declaration, publishing to GitHub Pages would stop working.
- The plugin now states its display name and the oldest moss it supports, so it reads as "GitHub" rather than "Github" wherever moss lists it — in Settings today, and in the plugin catalog arriving in a future release. Its published copy is now built and released from moss itself; the registry previously kept a second copy of the source, which had already begun to diverge.

## 1.5.1

### Patch Changes

- [#738](https://github.com/Symbiosis-Lab/moss/pull/738) [`8539776`](https://github.com/Symbiosis-Lab/moss/commit/853977618a92b5d66853be8ca9558012b45183e5) Thanks [@guoliu](https://github.com/guoliu)! - First publish of the github and matters moss plugins to npm under the @symbiosis-lab scope. Sources consolidated into the moss monorepo; published from the changesets workflow. (The five other plugins originally listed here — douban, linkedin, substack, x, xiaohongshu — do not yet exist as packages and were removed so `changeset version` can resolve.)

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Fixed (`1.5.1`): deploy from the active build generation instead of the now-permanently-empty `.moss/build/site/` (generations model). The plugin resolves `.moss/build/current` via `readlink`, derives the generation ID, and runs `git add` / `git write-tree --prefix` against `.moss/build/generations/<id>/`; the generated GitHub Actions workflow template now uploads from `.moss/build/current`. New exported `resolveCurrentGenDir()`. (#816)
- README / public-mirror documentation refresh.

## [1.5.0] - 2026-04-20

### Changed

- Open-source release: source moved to public mirror at Symbiosis-Lab/moss-plugins.
- CI integration via `pnpm test-plugins` in the monorepo test suite.

### Fixed

- Deploy pushes from `.moss/build/site/` (not stale `.moss/site/`).
- Deploy heartbeat re-emits last known step instead of hardcoded progress value.
- Remove `index.lock` before write-tree to handle iCloud re-locking race.
- `.moss/.gitignore` ownership moved into the moss-managed `.gitignore` (not plugin-owned).
- Resolve 240+ Dependabot security alerts in transitive dependencies.
