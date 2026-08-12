# OnionPress × moss integration — plan

**Status:** designed + verified, MVP scoped, not started · **Date:** 2026-07-11
**Partner:** [brewsterkahle/onionpress](https://github.com/brewsterkahle/onionpress) (Brewster Kahle / Internet Archive, AGPL-3.0; local checkout: sibling repo `onionpress/`)
**Architecture authority:** this plan conforms to the target architecture (#842), especially decision #31 (transport extensibility — onion is named there explicitly).

## Amendment 2026-07-21 — the plugin acquires the stack; v1 must just work

Ruled on [#849](https://github.com/Symbiosis-Lab/moss/issues/849#issuecomment-5029322323); this section supersedes the contradicted parts of the sections below.

- **Settled decision 2 partially reversed.** "The plugin cannot and should not manage OnionPress's lifecycle" stands for day-2 operation, but *acquisition* moves in-app: clicking install in the channels catalog triggers a download of the OnionPress payload with a progress indicator. The "Get OnionPress" empty state becomes the in-app download trigger, not an outbound link. v1 works without the user installing any dependency — verified feasible because OnionPress's DMG is already fully self-contained (bundled universal colima/limactl with the VZ entitlement, docker CLI, docker-compose, mkp224o, py2app Python; isolated `COLIMA_HOME` under `~/.onionpress`; system-docker fallback), and its inner `Contents/MacOS/onionpress` CLI performs the entire bootstrap headlessly (`start|status|address|setup|stop|quit`; `setup --user/--pass/--title` completes WordPress non-interactively). The plugin downloads the released DMG (~167 MB), stages the `.app` intact, and drives that CLI — never the menubar GUI. Only the Lima guest image and the four digest-pinned container images download at first start (OnionPress's own "3–5 minute" first launch); progress surfaces from `~/.onionpress/*.log`.
- **Gatekeeper:** moss downloads the payload with its own HTTP client, so no quarantine xattr is applied and the ad-hoc-signed app runs without the "Open Anyway" flow. moss replaces Apple as the integrity anchor: the plugin pins the expected SHA-256 of each OnionPress release artifact and verifies before staging. OnionPress must NOT be bundled inside moss.app (nested ad-hoc code would break moss's notarized signature); it stages in a moss-managed machine-wide location. Upstream notarization remains the right long-term fix — raise with Brewster.
- **Plugin delivery:** the MVP scope's "sideloaded in `.moss/plugins/` (no bundling, no moss release needed)" below holds only for the prototype/dev phase. Shipping the catalog-install flow requires the onionpress plugin (small JS bundle) to join the bundled roster (`build-config.toml` → `BUNDLED_PLUGIN_NAMES`) so its tile exists offline — the big download is the OnionPress payload, never the plugin.
- **Ownership split:** *download* = machine-wide, once per machine; *install* = per-folder plugin row in `.moss/plugins/` exactly like github/matters; *site pairing* = per-folder (onionname at first publish + persisted `site_url`). Multi-folder × one shared stack is resolved by OnionPress-side **multi-site support**: each folder pairs to its own site on the machine-wide stack, so `/status` discovery splits into stack liveness (machine) and site row (folder).
- **Job lifecycle** (forced by the stack download): a job is owned by the widest thing it mutates — session (UiBound, `FolderSession`), project (Detached, `DetachedRegistry`), machine (new scope). Navigation never cancels detached work; `DetachedTaskMeta` gains an owner key; the registry's watch channel feeds the anticipated menu-bar indicator.
- **UX prework** (designed 2026-07-21, landing ahead of any OnionPress code): capability filter on the channels catalog (invisible; context header + "Show all"), one-icon-path collapse, `BUILTIN_CHANNELS` registration table, channels-are-rows model in `docs/reference/channels.md` § Sources. Deploy-target "Host" row + download-progress surfaces follow in the visual-prototyping phase.
- **New open questions:** does install also *start* the stack the first time; disk-space preflight; resume/update policy for the staged payload (DMG re-download on release bump; container images update via digest-pinned pulls); per-site onion address vs shared + receiver upload namespacing (OnionPress-side, in our fork PRs).

## Goal

Make OnionPress a moss deployment option alongside moss-seta and GitHub Pages. moss stays the
content engine (markdown folder → static site); OnionPress serves it as a Tor onion service from
the user's own machine and keeps it persistent (OnionHeaven failover + Wayback Machine). The user
journey must be as simple as today's moss-seta flow: choose backend → publish → see the onion
address; optionally buy a domain in moss that points at the site; steps in any order. **Features
may be sacrificed; interface simplicity may not.**

## What OnionPress is (30 seconds)

A self-hosted WordPress reachable over a Tor v3 onion service, run from a laptop: five docker
services (tor incl. C-Tor/Arti + watchdog, wordpress, mariadb, autoheal, onionheaven) inside a
Colima VM on macOS / rootless docker on Linux. Ships ed25519 key management, mkp224o vanity
addresses, sleep/wake descriptor recovery, a browser extension, and **OnionHeaven** — a
heartbeat/takeover network (hub code in the same repo, production hub operated by the Internet
Archive) that serves 302→Wayback when a node goes offline. ~75k lines, very active, single
dominant author.

## Settled design decisions

1. **Content engine stays moss; syndication-to-WP rejected.** Pushing posts into WP via REST
   would have WP re-render moss content (fidelity loss, two render engines, keeps every WP cost).
   Rejected as the integration model; the receiver path below replaced it.
2. **One plugin wraps everything moss-facing** (per #842 decision #31: publishing = a
   `backend_plugin` behind the deploy seam, serving = outside moss entirely, naming = domains/-
   shaped, dynamic/social = channels/ rows later). The plugin cannot and should not manage
   OnionPress's lifecycle — OnionPress remains a self-managing companion app; the plugin is its
   embassy: detect, publish, configure, display status. moss never bundles tor.
3. **Reuse all of OnionPress, including WordPress — demoted to config panel + deploy receiver.**
   Apache (already in the WP container) serves any existing file before PHP runs. moss's sealed
   generation goes to `site-generations/<id>/` with a `site/current` symlink; an Apache rewrite
   serves non-`wp-*` paths from `site/current/` when the file exists, falling through to WP.
   Public onion surface = moss's static site; wp-admin/wp-json stay for OnionPress's ~28
   mu-plugins (Wayback archiver, directory/Follow, settings). **Empirically verified** in a live
   container (2026-07-11): static files serve with no PHP; `/wp-json` works on localhost AND the
   onion host with no canonical-redirect bounce (`WP_HOME` derives per-request from `HTTP_HOST`;
   `onionpress-domain-map.php` exists precisely to defeat host bouncing). Conditions found:
   effective `DirectoryIndex` is `index.php`-first so `/` needs an explicit rewrite; the rewrite
   must live in an image-level conf snippet (`a2enconf` pattern), NOT `.htaccess`, which
   OnionPress provisioning overwrites wholesale from `HTACCESS_BODY` in `multisite.py`; static
   paths can shadow multisite subsites — the receiver must collision-guard.
4. **Zero-config pairing: localhost trust, no credentials in the UI.** OnionPress's own
   `onionpress-auto-login.php` establishes "local machine = trusted." The receiver accepts local
   requests without a pre-shared secret and rejects the tor-container peer address (the onion
   path sets no forwarded headers — verified — so peer address is trustworthy). If upstream
   review wants real local auth, the fallback is the host Control API minting WP Application
   Passwords machine-to-machine; either way the UI shows zero prompts.
5. **Author-side Tor: route, don't embed.** OnionPress's tor already exposes SOCKS5 at
   `127.0.0.1:9050`. moss's reqwest already compiles with the `socks` feature; plugin
   `fetch_url`/`http_post` have no host restriction (verified) — so `.onion`-aware SOCKS routing
   is a small host-fn evolution. "View on onion" = browser panel via tauri `proxy_url`
   (macOS 14+, needs a device spike). If moss later wants Tor without OnionPress running:
   `arti-client` crate behind a lazily-bootstrapped host fn. **tor-ts** (kumavis) is a
   browser-tab Tor client via Snowflake — by its own README unaudited/experimental; it is the
   *visitor-side* research track (zero-install gateway page at OnionHome; live-failover widget;
   censorship-resilience service worker), never the plugin's Tor.
6. **Clearnet/DNS: no tor client in seta — go through OnionHeaven.** Fundamental limits: the
   clearnet has no rendezvous system (a domain needs *someone's* always-on public IP; Tor solves
   this only for onion addresses), and offline availability requires *someone* holding a copy.
   Chosen direction: contribute a **clearnet gateway role to OnionHeaven** (same repo — hub
   daemons + `web-server.py` API on 8083; every install already runs a hub-capable container;
   IA operates the default hub): TLS termination, reverse-proxy to the live onion,
   per-generation cache, heartbeat-triggered offline serving, Wayback deep fallback. moss/seta's
   role shrinks to registrar + one DNS CNAME (seta machinery for domain purchase/zone writes and
   the `configure_domain` plugin hook already exist and fit). Gateway behavior gets written down
   as an open contract so any operator (IA hub, user VPS) is interchangeable. Invariants that
   keep OnionPress "the deployment" and any gateway a commodity: origin = the user's machine;
   gateways never receive deploys (they cache by proxy/pull); DNS repointable by moss in one
   CNAME.
7. **Failover reality (verified):** onion side works — heartbeat stops → hub takes over the
   address (it holds the key) → `onionheaven-redirect.sh` 302s to the Wayback onion mirror.
   Clearnet side today has **none** — `config-template.txt` says verbatim that clearnet access
   requires the machine running continuously. The OnionHeaven gateway closes this: serve the full
   cached generation when offline (lossless for static sites — better than an archive redirect),
   Wayback 302 as cold-cache fallback.

## User journey (target)

- Publish: choose OnionPress backend → click Publish → (first time only) pick a username =
  **onionname**, OnionPress's existing sticky name registry on OnionHome ("DNS for the onion
  web", `/check` + `/suggest` + atomic register — the exact analog of the mosspub subdomain
  picker) → see the onion address. Address exists at install time (key already generated), so
  zero wait; vanity addresses (mkp224o, ~10–30 min for 5 chars) are an optional background job,
  never blocking publish.
- Domain: type + buy in moss (existing OpenSRS/Stripe flow, moss controls the zone) → moss
  writes CNAME → OnionHeaven gateway; `configure_domain` hook + orchestrator polling already
  exist for plugin backends. Build emits canonical URL + `Onion-Location` (spec-permitted
  `<meta http-equiv>`, works without header control).
- Any order: moss's domain orchestrator is already a reconciler (re-runs at project-open and
  after deploys, single-flight, polls until live).

## MVP / prototype scope (~8–11 engineer-days, two small PR sets)

Demo: open folder in moss → Publish → site live at `http://<addr>.onion`, moss's real rendering,
from the laptop. Publish twice → second flip visibly atomic. wp-admin intact on localhost. Theme
byte-identical in Tor Browser. WordPress mode untouched for existing OnionPress users.

**OnionPress side (~3–5 d, PR-able, additive):**
- Receiver mu-plugin — WP REST `onionpress/v1`: `GET /status` (onion address + live generation),
  `POST /generation` (tar of sealed generation — one request; dodges moss's 30s deploy-hook
  timeout), `POST /commit` (atomic `site/current` symlink flip; wp-*/subsite collision guard);
  localhost-trust gate rejecting the tor-container peer. Careful parts: path-traversal
  sanitization, old-generation cleanup. (2–3 d)
- `onionpress-static-site.conf` — the verified rewrite (+ explicit `/` rule, `wp-*` exclusions),
  `a2enconf`'d in the WP image Dockerfile; manual matrix onion+localhost × site/admin/api/subsite.
  (0.5–1 d)
- Onion-address plumbing — WP container doesn't know its own address; provisioning writes it to a
  WP option via wp-cli. Placement = Brewster's call. (0.5 d)

**moss side (~3–4 d):**
- OnionPress plugin — sideloaded in `.moss/plugins/` (no bundling, no moss release needed);
  GitHub plugin as template; `deploy` hook: tar `DeployContext.site_files`, POST, commit, toast
  with onion URL; `/status` probe for zero-config discovery + "Get OnionPress" empty state.
  (2–3 d)
- ONE moss-core touch: plugin deploy result may supply canonical `site_url`, persisted to
  `[deployment]` in state.toml, so builds stamp onion URLs with zero user config. Small
  command/type change + `chore(bindings)` regen. `http://` site_url already accepted
  (`build/site_url.rs`). (1 d)

**Integration + demo (~1–2 d).** Sequencing: conf + receiver first (curl-testable with no moss
involvement — retires all remaining risk in ~2 days), then plugin, then site_url PR, then demo.

**Stretch (not committed):** "View on onion" proxied panel; deploy progress in the ship-ring.

**Risks:** PHP upload limits for the tar route (check in the image early); onion-address plumbing
placement; upstream review latency (mitigation: run on a fork/branch until landed); if
localhost-trust is rejected upstream → host Control API comes forward (+2–3 d, UI unchanged).

## #842 alignment (deliberate)

- Pure decision-#31 plugin transport; registers exactly like GitHub Pages (no
  `get_builtin_channel_ids`-style special-casing — the anti-pattern M3 retires).
- Nothing lands in legacy deploy paths: we call but never extend
  `preview/commands.rs::deploy_site` (M5d deletes it; the plugin rides into `deploy/facade.rs`
  for free when it lands).
- Not built yet on purpose: facade.rs (M5d), SiteStatus feeding (M5d), channels/ row for
  directory/Follow (M3), BuildInputs URL-policy port (M6a — today's site_url plumbing suffices).
- The one core touch lands at the current single owner of `DomainDeploymentConfig`
  (`domain/types.rs`), no second writer of any fought-over concern.

## Deferred roadmap (post-MVP, rough order)

1. Host Control API in OnionPress (loopback + token: status, start/stop, vanity job, key backup,
   config get/set, app-password mint) → moss plugin panel controls OnionPress; pairing stays
   invisible.
2. First-publish wizard contribution + onionname registration step; vanity as background job.
3. OnionHeaven clearnet gateway (upstream contribution + the gateway contract doc); moss domain
   flow points CNAME at it; per-generation cache + offline serving + Wayback fallback.
4. Plugin-system evolutions the example forces: plugin-declared DNS records; long-running deploy
   jobs/progress; status-provider hook into SiteStatus (post-M5d); `.onion`-aware SOCKS routing
   host fn; later `arti-client`.
5. Wayback SPN sidecar for static profile; directory/Follow as a channels/ row (post-M3);
   visitor-side tor-ts experiments (gateway page at OnionHome first).

## Open questions

- Onion-address → WP option plumbing placement (Brewster).
- Localhost-trust posture acceptable upstream? (fallback scoped)
- Upstream appetite for the OnionHeaven gateway role (TLS-terminating proxy for user domains is
  an IA policy question).
- moss multi-target deploy (`[[deploy]]`, ADR-012's anticipated shape) — only needed for
  clearnet+onion *mirror* mode; not needed for the journey above (one backend serves all
  hostnames). Becomes a decision-log row when mirror mode is wanted.

## Evidence index (key verified claims → where)

- Static-first + dual-host serving: live-container verification 2026-07-11 (agent report in the
  design session): `/license.txt` served with no `X-Powered-By`; effective DirectoryIndex from
  `docker-php.conf`; `.htaccess` owned by `multisite.py:71-93`; PROXY-protocol vhost on :81 is
  dead code (socat → `wordpress:80` plain TCP — `tor/entrypoint.sh:259`, `arti.toml:26`).
- Onion failover: `tor/onionheaven-redirect.sh` (302 → `web.archivep75….onion/web/…`,
  `X-OnionHeaven-Takeover: 1`); clearnet gap: `app/Resources/config-template.txt` AVAILABILITY
  NOTE; hub API: `tor/web-server.py` (8083, `/online` `/offline` `/unregister`); hub-capable
  container in every install: compose `onionheaven:` service (`ONIONHEAVEN=1`).
- onionnames registry: `tor/onionnames.py` ("DNS for the onion web", OnionHome-only, sticky).
- onionpress.org: Cloudflare NS + `server: cloudflare` + `onion-location:` header → the repo's
  own cloudflared tunnel mechanism (`docker-compose.cloudflare.yml`).
- moss readiness: `http://` accepted by `src-tauri/src/build/site_url.rs:48`; plugin deploy
  contract `plugins/types.rs:555` (`DeployContext`) + 30s hook timeout `plugins/manager.rs:1773`;
  `configure_domain` hook wired in `domain/orchestrator.rs` (OpenSRS zone writes for
  plugin-deployed sites + post-DNS hook + polling); reqwest `socks` feature in Cargo.toml;
  `fetch_url`/`http_post` unrestricted (`plugins/runtime.rs:48`).
