# Changelog

## 1.4.2

### Patch Changes

- [#738](https://github.com/Symbiosis-Lab/moss/pull/738) [`8539776`](https://github.com/Symbiosis-Lab/moss/commit/853977618a92b5d66853be8ca9558012b45183e5) Thanks [@guoliu](https://github.com/guoliu)! - First publish of the github and matters moss plugins to npm under the @symbiosis-lab scope. Sources consolidated into the moss monorepo; published from the changesets workflow. (The five other plugins originally listed here — douban, linkedin, substack, x, xiaohongshu — do not yet exist as packages and were removed so `changeset version` can resolve.)

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

_Pending publish — cumulative since `1.1.2` (last released on main); full detail under [1.4.0] and [1.2.0]._

- Fixed (`1.4.9`): typeset equations still show up when syndicated to Matters. moss's website now typesets math as an inline image (SVG), but Matters' editor cannot show that image — it silently drops it, so an equation would have vanished from the Matters copy while the sync still reported success. The syndicated copy now falls back to the equation's LaTeX source (e.g. `$E = mc^2$`), the same readable form used before typesetting existed, taken from the accessibility text the typeset image already carries. A Matters reader always sees the formula, never a blank. (A future step may upload the equation to Matters as a picture; the source fallback is the correct behavior until then.)
- Fixed (`1.4.8`): equations now survive syndication to Matters. moss renders math as its LaTeX source, and Matters' sanitizer collapses newlines inside a paragraph — so a multi-line display equation arrived as one run-on line, and a LaTeX `%` comment (which ends at a newline) swallowed everything after it, publishing a valid-looking but **wrong** formula with no author-visible signal. A display equation alone in its paragraph is now hoisted into `<pre><code>`, the only whitespace-preserving container Matters keeps, so `align`/`cases` line structure survives; `%` comments are dropped from every equation, hoisted or not, since a comment is lossless for the formula while a collapsed newline is not.
- Fixed (`1.4.8`): images, audio embeds and display equations alone in a paragraph are wrapped/hoisted again. These transforms matched a bare `<p>`, but the HTML the plugin receives (`article-map.json`) keeps moss's `data-source-line` attribute on every top-level paragraph — the attribute is stripped only from the shipped page files. So the hoists matched nothing in practice and the affected content degraded to Matters' fallback handling.

- Fixed (`1.4.7`): a locally renamed collection folder is no longer re-created on every sync. Collections now have identity like articles: (1) a collection whose id is in `config.knownCollectionIds` is never re-created — a local rename/move/delete is authoritative, matching the "download new content only" model; (2) collection files carry their Matters collection URL (`https://<domain>/@user/collections/<id>`) in `syndicated:` as an identity marker (stamped on creation and backfilled byte-preservingly into the resolved home file of collections synced before the marker existed), so syncs recognize them under any local name even without config state; (3) new member articles are placed into the collection's *resolved* local location — marker location first (layout-aware: self-named/index folder homes map to their folder, plain pages to their own URL), else the folder holding the plurality of already-synced member articles that belong to this collection first (a shared resolved dir is kept only by the collection with the most own-member votes; unresolved known collections place new members at the article-folder root, never re-creating a remote-title folder). Homepage pinned-works links go through the same resolution. **BREAKING (types):** `syncToLocalFiles` gained an optional `knownCollectionIds: Set<string>` parameter and its result now includes `syncedCollectionIds: string[]` — persist `nextKnownCollectionIds(stored, syncedCollectionIds)` (union; a failed creation is absent and retried next run, and ids missing from one remote fetch are kept). New exports: `collectionUrl(userName, collectionId)` / `extractCollectionId(url)` in `domain.ts`; `scanLocalContent()` / `majorityParentDir()` / `nextKnownCollectionIds()` in `sync.ts` (`scanLocalArticles()` is now a thin wrapper; collection marker files never enter the social-fetch list or influence article-folder/bound-user detection). `extractShortHash` now returns `null` for `/collections/` URLs instead of a bogus hash when the id contains a hyphen.
- Fixed (`1.4.7`): `parseFrontmatter` now reads serde_yaml-normalized frontmatter — unindented `- item` list entries, single- and double-quoted values in both scalars and list items, with YAML `''` → `'` unescaping — in addition to the plugin's own `  - "item"` emission. moss's uid stamping rewrites every synced file into the normalized form, which made `syndicated:` arrays invisible to the plugin — silently disabling article dedup, folder detection, and comment fetch for stamped files.

- Changed (`1.4.6`): settings panel cleanup. **BREAKING:** removed the `auto_publish` config field/toggle — nothing in the plugin ever read it, so this is dead-config removal with no behavior change. **BREAKING:** removed the `sync_drafts` config field/toggle; draft import is now permanently off (`shouldSyncDrafts()` takes no config and always returns false), matching the default essentially every project already had in practice. Renamed the "Sync On Build" toggle to "Auto-Import Posts" (same `sync_on_build` config key — only the label changed) since it specifically controls automatic import of new Matters.town posts/drafts on each rebuild, not the general sync-status concept shown elsewhere on the same panel. "Add Canonical Link" now correctly shows ON by default for a project that has never touched the setting (previously it always rendered off regardless of the manifest's declared default).
- Fixed (`1.4.6`): a settings toggle you changed could silently stop taking effect once the plugin had written its own `config.json` (e.g. after first login) — `get_plugin_config` treated `config.json` and `config.toml` as alternatives instead of merging them, so `config.toml`'s settings-driven fields (Add Canonical Link, Auto-Import Posts) became invisible the moment `config.json` existed. Both files are now merged, with `config.json` winning on a genuine key conflict.
- Changed (`1.4.5`): a no-network Matters sync failure is now quiet. It surfaces a sync-status row on the Matters settings page (driven by the plugin task lifecycle) instead of a persistent blocking toast, the duplicate Rust "plugin could not run" advisory is suppressed for the self-reporting Matters plugin (capability-gated), and the redundant per-preview custom-domain configuration no longer posts a red "Could not configure …" error on every preview rebuild (throttled, with the backoff cleared on deploy).
- Fixed (`1.4.4`): images whose CDN URL returned a non-retryable HTTP error (403, 404, 410) are now recorded in `failed-media.json` so subsequent builds skip them without a network attempt, eliminating the repeated "Image could not be downloaded" advisory toast on every sync. Permanently unavailable images are listed in the Matters settings page for review. Transient errors (5xx, timeouts) are still retried on the next build and are not memoized.

- Added: standalone, reopenable Matters login. A new `login` capability lets you connect your account from Settings or when previewing an unlogged vault — no import required — via the shell's single-bar login chrome; login auto-opens once on an unlogged preview with a dismiss latch so it doesn't nag, and a locale-aware "Connected to Matters" toast confirms success (the profile language is now persisted on the first login so the toast localizes correctly).
- Fixed: fast logins are no longer missed — the first cookie check starts after 1 s instead of 20 s, there's no artificial login timeout, and the in-flight watchdog no longer fires while a hook is awaiting keys. Login-path milestones (connect / panel / url / domain) are now logged for diagnosability.
- Fixed: login is now detected on the staging web app (`matters.icu`) — its auth-token cookie is named `__dev__access_token`, not production's `__access_token`. The login poll now derives the cookie name from the resolved domain (`accessTokenCookieName()`) instead of hardcoding the production name, so staging logins were previously never detected.
- Changed (`1.4.1`): the login flow is quieter and recoverable — a cancelled or failed Matters login now returns you to the editor (empty-folder onboarding) instead of leaving an empty action panel, the login status label reads calmer, and the in-flight watchdog is preserved across the cancel.
- Fixed (`1.4.1`): a freshly imported vault's homepage title comes from the vault folder name, not the Matters display name.
- Fixed: the import progress bar no longer stalls during media download. Per-article sync and image-download progress now drive the unified progress surface, so the hairline advances smoothly through the heaviest phase. (These previously used a legacy progress channel that moss's panel drops for background imports, so the bar appeared frozen while images downloaded.)
- Changed: the sync receipt now leads with a noun and reads as one fact — e.g. "12 articles already up to date" instead of a bare, truncated "5 unchanged, images: 1 failed, 0 new comments". Image/link/comment outcomes no longer clutter it (zero-count clauses dropped), and a failed image download is surfaced as its own advisory carrying the image's **URL** (the dead CDN reference still in the body) so you can see which image broke, rather than an opaque "1 failed" count.
- Fixed: section headings no longer show a stray `#` on Matters. moss appends a hover-only `<a class="moss-heading-anchor">#</a>` permalink to every heading; Matters' sanitizer kept the `#` text, so headings synced as e.g. "1.#". The anchor (web-only chrome) is now stripped during syndication. Verified against `server.matters.icu`.
- Fixed: comments now download for articles syndicated with a Matters **short-link** URL (`https://matters.town/a/<shortHash>`), not only the canonical `https://matters.town/@user/<slug>-<shortHash>` form. Previously `extractShortHash` required a hyphen in the final path segment, so short-link articles were silently dropped from `scanLocalArticles` and never fetched comments. The two duplicate `extractShortHash` implementations (sync + downloader) are now one shared function in `domain.ts` that understands both forms; an unparseable syndicated URL is now logged instead of dropped silently.
- Fixed: images, covers, and audio now upload to Matters correctly. Assets are uploaded by **bytes** read from the local build output (multipart `singleFileUpload`), not by URL. Matters' server cannot reliably fetch assets by URL from a deployed site (Caddy/moss-seta hosts return `UNABLE_TO_UPLOAD_FROM_URL`), and `embedaudio` rejects url-upload entirely — so previously images often broke and audio never uploaded. On upload failure, image/audio srcs fall back to the absolutized deployed URL so they still display. Verified end-to-end against `server.matters.icu`.
- Fixed: audio embeds now syndicate to Matters at all. moss's `<audio class="moss-embed">` is rewritten into Matters' required `<figure class="audio">` shape (the only shape its sanitizer keeps; previously the entire `<audio>` was stripped to stray fallback text), then the audio bytes are uploaded via `embedaudio`.
- Local-first comments: `uid` contract, env-derived Artalk server URL, tombstone reconcile, morph-proof preview stub.
- Social data written to `.moss/data/social/`; stranded-comment recovery.
- Session-expiry handling: JWT decode, tri-state session, dead-token filter, trigger-aware auth routing, honest receipts.

## [1.4.0] - 2026-06-11

### Added

- Local-first comments integration: `uid` contract, env-derived Artalk server URL,
  tombstone reconcile, morph-proof preview stub.
- Social data written to `.moss/data/social/` alongside build; recovers stranded comments.
- Diagnostic advisories on hook-failure with full refetch on cleared counts.

### Fixed

- Full refetch on cleared platform counts to avoid stale display.

## [1.2.0] - 2026-06-04

### Added

- Session-expiry handling across 7 implementation tasks (T1–T7):
  - Decode JWT `exp` claim locally (T1).
  - Tri-state session check with dead-token filtering and persisted nudge stamp (T2).
  - Typed `MattersAuthError` from response bodies (T3).
  - Pure trigger-aware auth router (T4).
  - Trigger-aware auth routing, gated binding guard, honest receipts (T5).
  - Mid-sync auth failure copy and tri-state syndicate gate (T6).
  - Review fixes: cookie dead-token filter, `queryMode` reset, receipt copy (T6.5).
  - Reconciled plugin version after rebase (T7).
- `MOSS_MATTERS_DOMAIN` env var to switch test/prod domain in-webview.
- `MOSS_MATTERS_TEST_PROFILE` env var bypasses login in test builds.
- moss-injected trigger context; terminated leaked background tasks.

## [1.1.2] - 2026-05-30

### Changed

- Reconcile plugin manifest after QuickJS runtime upgrade in moss v0.7.x.

## [1.1.1] - 2026-05-29

### Fixed

- Rebuild bundled plugin correctly on release build (`cargo build --release`).
- Language-aware article folder (文章 for Chinese content).
- Convert HTML via moss's shared htmd converter.
- Emit filename-only wikilinks for assets.
- Trim tag whitespace; localize legacy non-UUID assets.
- Pre-merge review fixes: G runtime no-op, title wikilink, hairline clip.

### Added

- Generate self-named home article with `home: true` marker.
- Marker-aware home detection exposed to plugin-facing API.

## [0.0.2] - 2026-05-29

> **Note:** This npm publication was experimental. The plugin version lineage returned to
> 1.x after the open-source consolidation; `0.0.2` is documented here for history only
> and was never successfully published to npm.

Initial publication attempt under the `@symbiosis-lab` scope, bundled with the
open-source release pipeline.
