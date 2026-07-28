# Changelog

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
