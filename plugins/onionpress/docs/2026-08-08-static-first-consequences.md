# Static-first: what still assumes PHP runs on a front-end request

Audit only — no fixes applied here, no OnionPress files touched.

## The mechanism

OnionPress now installs `app/Resources/docker/wordpress/onionpress-static-site.conf`
at every provision (`multisite.py:install_static_site_conf()`, called from
`provision_post_install()`), as a conf-enabled `<Directory /var/www/html>` block with
`RewriteOptions InheritDownBefore`, so its rules run *before* WordPress's own
`.htaccess` rewrite rules on both the `:80` host vhost and the `:81` PROXY-protocol
vhost the Tor container forwards onion traffic to. Four `RewriteCond`/`RewriteRule
[END]` blocks serve a file out of `site/current/<path>` (the moss generation
symlink) whenever one exists, and stop rewrite processing entirely (`[END]`, not
`[L]`) so WordPress never gets a second pass. The exclusion is a single pattern,
applied to every block except the root-path one: `RewriteCond %{REQUEST_URI} !^/wp-`.
Two properties of that pattern matter and are the root of most findings below:

1. **It's a prefix match on path only.** Anything starting `/wp-` — `/wp-admin/`,
   `/wp-login.php`, `/wp-json/*`, `/wp-cron.php`, `/wp-comments-post.php`,
   `/wp-sitemap.xml` — always reaches PHP. Everything else is static-eligible.
2. **The root-path rule doesn't even check the exclusion — it matches on
   `%{REQUEST_URI} =/` alone, and `REQUEST_URI` excludes the query string.**
   `/?op_login=TOKEN`, `/?s=search+term`, and `/?preview=true&p=123` are therefore
   *all* served the static homepage verbatim, with zero relationship to what's in
   the query string. This is broader than the single auto-login bug that prompted
   this audit — it's a class: any PHP behavior gated on a query string against the
   root path is dead, not just this one plugin.

Everything below turns on where the request path lands relative to that `/wp-`
prefix, and — for `/`-only cases — whether the query string was ever going to be
consulted at all.

## Surfaces

| # | Surface | Verdict | Evidence |
|---|---|---|---|
| 1 | Auto-login (`?op_login=`) | **Broken** | `onionpress-auto-login.php:21-30` hooks `init`, gated on `$_GET['op_login']`. Login URLs are built as `http://localhost:PORT/?op_login=TOKEN` (`linux/onionpress:2308`, `menubar.py:_generate_login_url`). The exact-`/` rule swallows the query string before `init` ever fires. |
| 2 | wp-cron (all scheduled hooks) | **Broken, no mitigation exists** | No `DISABLE_WP_CRON` anywhere in the repo; WP's default `spawn_cron()`-on-page-load behavior is intact but now only triggers on `/wp-`-prefixed requests (admin, login, REST). No system crontab or WP-CLI `cron event run` found in `linux/onionpress-heartbeat.py`, `onionpress-watcher.timer`, `onionpress-service.py`, or launcher scripts. Several plugins (wayback-archive, social-archive-{blog,mastodon,bluesky}) have opportunistic loopback POSTs to `wp-cron.php`, but every one only fires from *inside* an already-running PHP request — none can bootstrap a stalled queue from zero. Matches the observed `onionpress_wayback_sweep` last-run of 2026-07-30. |
| 3 | Wayback fallback content | **Degraded (as designed elsewhere, blocked upstream by #2)** | OnionHeaven takeover mechanism itself works (confirmed live: 9 takeovers / 145 probes, 2026-08-08 20:28–20:31), and Save Page Now correctly receives moss's static output when it *does* crawl (see "Confirmed correct" below) — but the sweep that submits new snapshots is wp-cron-driven, so the archive it falls back to never advances. Not a static-first defect on its own; a downstream symptom of #2. |
| 4 | Theme onion-address header (`onionpress_follow_get_own_address`) | **Broken (stale, generalized)** | `functions.php:151-169` reads `$_SERVER['HTTP_HOST']`, called from `header.php:45-46` (every theme page) and `page-follow.php:14`. Both require PHP template execution. Since `/` and most content paths are now static, the badge shown to visitors is frozen at whatever value existed when moss last captured the page — not computed from the actual request Host. Confirms and generalizes the localhost-specific case already recorded at `tests/test_install_invariants.py:724`. |
| 5 | `onionpress-hit-counter` plugin | **Unknown — needs moss-session verification** | Activated at every provision (`multisite.py:431` → `install_onionpress_theme` → `provision_post_install`). Rendering is wired to the theme's `onionpress_footer` action (`functions.php:67-74`, `do_shortcode('[hit_counter]')`), which only fires when PHP renders the page. The AJAX increment/read hooks (`wp_ajax_increment_counter`/`wp_ajax_nopriv_increment_counter`) live at `/wp-admin/admin-ajax.php`, which *is* PHP-reachable — so if moss's static capture preserved the counter markup and its JS+nonce, the counter can still tick; if moss didn't capture it, it's silently absent. Whether moss's generator captures this DOM/JS is not visible from the OnionPress repo. |
| 6 | Comments (form vs. POST) | **Degraded, split** | `single.php:17-18` → `comments_template()` (WP core) only runs when PHP renders the page — dead on a static page. `wp-comments-post.php` matches `/wp-` and does reach PHP normally, **but** the form action/nonce embedded in a static page is only fresh at generation time; a nonce baked by moss and then served unchanged for the life of the generation will fail WordPress's nonce check once it expires (WP nonces have a ~24h validity window). Whether moss re-bakes the page (and a fresh nonce) often enough to matter is outside this repo. |
| 7 | Search (`/?s=`) | **Broken (newly found, not in original list)** | No custom `searchform.php` in the theme, so all search traffic is WP core's default `?s=` query against the root permalink. Same root-path/query-string-blind rule as #1 swallows it — search silently returns the static homepage instead of running a query. |
| 8 | Feeds (`/feed/`) | **Unaffected, contingent** | `/feed/` has no `/wp-` prefix, so it's static-eligible — but the `-f` (file-exists) conditions on all three non-root rules mean it only gets swallowed if moss's generation actually ships a literal `feed`/`feed/index.html` path. If moss doesn't emit one, the request falls through unchanged to WordPress's own feed rewrite. Depends on moss's output shape — not verifiable from this repo. |
| 9 | `robots.txt` | **Unaffected, contingent** | Same reasoning as feeds: falls through to WP's virtual `do_robots` handler unless moss emits a literal static `robots.txt`. |
| 10 | Core sitemap (`/wp-sitemap.xml`) | **Unaffected** | Matches `/wp-` prefix — always reaches PHP. |
| 11 | Social-archive mu-plugins, visitor-facing hooks | **Broken on static pages** | All five `onionpress-social-archive*.php` files are always-loaded MU plugins. Visitor-facing hooks — `wp_nav_menu_items`, `pre_get_posts`/`loop_start`, `wp_footer`, `wp_head`, `the_content`/`the_excerpt` — all require PHP template execution and never fire on a static page. Admin-facing hooks (`admin_menu`, `admin_init`, `admin_post_*`) are unaffected (`/wp-admin/` still PHP). Their cron-driven sync daemons share the wp-cron starvation in #2. |
| 12 | `onionpress-moss-receiver.php` (publish endpoint) | **Unaffected — confirmed by design** | Registers `/wp-json/onionpress/v1/{status,generation,commit}`. `/wp-json` matches the `/wp-` exclusion prefix, so these routes are never shadowed by the static rules regardless of what's in the current generation. Publishing is unaffected by construction. |
| 13 | OnionHeaven `_check_wordpress_healthy` | **Broken — false positive, most serious finding** | `health.py:127-139` runs `curl -sf http://localhost/` *inside* the WordPress container — the bare root path. Per the conf's first rule, `/` is served directly from `site/current/index.html` with `[END]`, without invoking PHP at all. This means the health check reports healthy on a 200 from Apache/static-file-serving alone, even if PHP-FPM/mod_php is fully wedged or the database is unreachable, as long as any generation exists on disk. Contrast: the actual Docker Compose healthcheck (`docker-compose.yml:68`) deliberately probes `/wp-login.php`, which is correctly `/wp-`-excluded and does exercise PHP — so the *container* healthcheck is sound but OnionHeaven's *own* check is not, and they can now disagree. |
| 14 | Onion-address shared-volume write | **Unaffected** | `write_shared_onion_address()` (`multisite.py:510-531`) is a `docker exec` file copy (`hostname` → `/var/lib/onionpress/onion_address`) triggered from `provision_post_install()` — not an HTTP request at all. |
| 15 | `onionpress-domain-map.php` (multisite domain mapping) | **Degraded, likely immaterial** | MU-loaded, runs on every PHP request; simply doesn't run on static front-end paths (dead weight there, not breakage) since those pages are pre-rendered and don't need live domain rewriting. `/wp-admin/`, `/wp-login.php`, `/wp-json/*` still get correct domain mapping. |
| 16 | `onionpress-login-fix.php`, wayback/social-archive admin-dashboard link helpers, `onionpress-wayback-archive.php` admin rendering | **Unaffected** | All fire only inside `/wp-admin/`-scoped or `/wp-login.php`-scoped requests. |
| 17 | `onionpress-directory.php` (`parse_request` hook, Onion-Location header) — for an OnionHome-role instance | **Unknown** | Requires PHP execution per-request; if a future/other OnionHome-role deployment also runs this static-first conf on its own `/`, the same class of breakage applies. Nothing in this repo shows OnionHome itself running the static conf today, so flagged unknown rather than broken. |
| 18 | Post-preview links (`/?preview=true&p=123`) | **Broken (newly found, same root cause as #1/#7)** | Same query-string-blind root-path rule. Any preview link whose permalink resolves to `/` is served the static homepage instead of the live preview. |

**Confirmed correct, not a defect:** Save Page Now crawling the `.onion` receives
moss's static output (`data-moss-html-version="1"` etc.) — that is the intended
behavior; the archive content itself is correct. The only problem is that nothing
schedules new snapshots (#2/#3).

**Bucket counts:** broken — 6 (#1, #2, #4, #7, #13, #18); degraded — 5 (#3, #6, #11, #15, and #3 restated); unaffected — 6 (#8 assuming moss ships nothing, #9 same caveat, #10, #12, #14, #16); unknown — 3 (#5, #6's nonce-freshness half, #17). #6 and #8/#9 straddle two buckets because the verdict is contingent on moss's output shape, called out explicitly above rather than forced into one bucket.

## Ranked fix list (harm-ordered, options only — no implementation)

1. **OnionHeaven health check false-positive (#13).** Highest harm: it can mask a
   fully dead PHP layer — DB down, PHP-FPM crashed — from fleet monitoring
   indefinitely, because a static generation alone is enough to return 200. Cheapest
   correct fix: point `check_wordpress_local()` at `/wp-login.php` instead of `/`
   (mirrors the already-correct Docker Compose healthcheck at
   `docker-compose.yml:68`) — one-line URL change, no new plumbing, and it's already
   proven to still exercise PHP under this conf.

2. **wp-cron never fires (#2), and everything downstream of it (#3, social-archive
   sync in #11).** Second-highest harm: silently stops *all* scheduled maintenance
   (Wayback sweeps, update checks, site health, transient cleanup, social-archive
   sync), not just one feature, and there is zero existing mitigation to fall back
   on. Options, trade-offs only:
   - **`DISABLE_WP_CRON` + a container-side cron/timer that curls `/wp-cron.php`
     directly.** Correct and standard WP practice; needs a driver process inside or
     alongside the WordPress container (systemd timer, a cron package in the image,
     or a call from the existing `linux/onionpress-watcher.timer` if one already
     polls on an interval). Blast radius: touches the Docker image / provisioning,
     needs to survive container restarts.
   - **Leave `spawn_cron()` as-is but exclude `/wp-cron.php` more generously and
     have something *external* hit `/wp-cron.php` on an interval** (e.g. from the
     Python launcher/menubar, which already runs on a schedule). Smaller surface
     change than a container-level timer, but ties WP's cron liveness to the
     desktop app being open, which may itself be an availability assumption to
     avoid for a "self-hosted, always-on" onion service.
   - **Do nothing, accept degraded maintenance cadence, and only special-case the
     Wayback sweep** by giving *it alone* an external trigger. Cheapest short-term,
     but leaves update checks, site health, and social-archive sync equally stalled
     — it treats the symptom this audit happened to notice, not the mechanism.

3. **Auto-login and the wider root-query-string-swallowing class (#1, #7, #18).**
   Lower user-visible harm than #1/#2 (auto-login has a fallback: manual
   `/wp-login.php`; search absence is a missing feature, not corruption) but it's a
   single root cause worth fixing once rather than three times. Cheapest correct
   fix: tighten the root-path rule's `RewriteCond` to also require an empty query
   string (Apache: add `RewriteCond %{QUERY_STRING} =""` alongside the existing
   `RewriteCond %{REQUEST_URI} =/`), so `/` with no query string still gets the fast
   static path but `/?anything=...` falls through to WordPress like every other
   query-bearing request already does. This fixes auto-login, search, and preview
   links in the same one-line change, with no plugin code touched.

4. **Theme onion-address header staleness (#4).** User-visible but low-severity
   (wrong badge text, not a functional failure) and already partially known via the
   existing test. Cheapest correct fix is a moss-side one, not an OnionPress one:
   have moss bake the onion address into the static output at generation time from
   the same source `functions.php` reads (`/var/lib/onionpress/onion_address`),
   rather than leaving it to a PHP call that no longer runs. Out of scope for this
   audit to design further since it crosses into moss's generator.

5. **Hit-counter (#5) and comment-nonce freshness (#6).** Both are "unknown,
   contingent on moss capture behavior" rather than confirmed breakage — no fix
   should be designed before the Mac-side verification below settles what actually
   happens.

## What needs the Mac to confirm

- **#5 (hit counter):** whether moss's static capture preserves the counter's
  markup, inline JS, and AJAX nonce. Needs inspecting an actual generated static
  page's HTML for `onionpress-hit-counter` output, or the moss capture/generator
  source (not present in this Linux checkout of `onionpress`).
- **#6 (comment nonce freshness):** whether a comment form nonce baked into a
  static generation is still valid by the time a real visitor submits it — depends
  on how often moss regenerates relative to WP's nonce lifetime (~24h). Needs a
  live end-to-end comment-submission test against a real generation's age.
  **`tests/test_install_invariants.py:724`** (the already-known onion-header
  localhost failure) is the closest existing test infrastructure to extend for
  this — it's a Mac-run integration test, not something exercisable from this
  Linux worktree.
- **#8/#9 (feeds/robots.txt static shadowing):** whether moss's generator emits
  literal `feed`/`robots.txt` files in its output; if it does, item 8/9's verdict
  moves toward "broken" rather than "unaffected." Requires reading moss's generator
  output shape, which lives in the moss repo/Mac session context for OnionPress
  integration, not in the `onionpress` checkout used for this audit.
- **#17 (OnionHome role):** whether any deployed instance runs the OnionHome role
  with this same static-first conf on `/` — not decidable from static reading of
  this repo; needs checking actual OnionHome provisioning config.

## Provenance

Investigated 2026-08-08 from a read-only pass over `~/repo/onionpress` (two other
dispatches — `watchdog-escalation`, `wp-admin-door` — were live in that repo at the
time; nothing there was written). Apache conf verified directly at
`app/Resources/docker/wordpress/onionpress-static-site.conf`; OnionHeaven health
check verified directly at `src/onionpress/health.py:127-139` against
`app/Resources/docker/docker-compose.yml:68`.
