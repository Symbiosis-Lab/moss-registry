# Changelog — moss-plugin-ipfs

## Unreleased

The deploy tab now shows one address row per fact instead of seven near-duplicates: **IPNS name** and **CID** are each both copyable and openable, plus your provider's own **Local gateway** or **Pinata gateway** door, and a **Custom domain** row once DNSLink is set. The View-site button and toast now always open the public gateway address (your custom domain, else the IPNS name, else the CID) rather than a `localhost` link that only worked on the machine that published it.

## 0.2.0

Migration to moss's plugin setup contract (moss ≥ 0.11.7). The plugin no longer draws any setup UI: moss renders its settings and credential dialogs from the manifest, and the plugin answers `check_setup` verdicts.

- Settings are declared in `contributes.deploy_target.setup.settings` — a typed `provider` select (Pinata / local Kubo), a `secret` Pinata token with a `when` condition, and the existing options — replacing the top-level `config`/`config_schema`/label/description maps.
- The Pinata JWT lives in moss's OS keystore as the declared `pinata_jwt` secret. The plugin reads it with `get_plugin_secret` and, on a 401/403, hands it back with `reject_plugin_secret` so moss forgets it and re-asks with the reason. The cookie-jar storage and the plugin-drawn token panel are gone; an existing cookie-stored token is not migrated — moss asks once on the next publish.
- `check_setup` replaces `runSetup`: Pinata verdicts pre-flight the token; local verdicts probe the daemon and return blockers (`start_daemon`, `change_port`, `recheck`) whose buttons moss draws. Daemon-start consent is the click on "Start IPFS", asked exactly when it applies instead of once per project.
- Deploy no longer opens setup UI mid-hook; when the provider isn't ready it fails with the reason and points back at setup.
- Deleted: `setup-panel.ts`, `panel-common.ts` (the result panel keeps its own escaping and stylesheet), the cookie credential machinery, and the per-project daemon-consent state.

## 0.1.0

Initial release.

- `deploy` to IPFS via **Pinata** (v3 Files API) or a **local Kubo node** (RPC), behind
  one provider interface; byte-identical CIDs across backends.
- Structure verification on first deploy per provider (Pinata: from the upload response;
  local: via RPC `ls`); a proven-broken tree fails the deploy loudly — never a silent
  broken site.
- Stable **IPNS**: names derived from a moss-held ed25519 key (`getKey`/`signWithKey`;
  record built and signed in-plugin, published via Kubo `routing/put`). One owner — there
  is no fallback to a node's own keystore, which would publish the site at a different
  permanent address. The record lives 48 hours and is republished only by your next
  publish; the key lives in the project's gitignored `.moss/keys/`, so a second machine
  needs a copy of it to publish the same name.
- **DNSLink** custom-domain support via the standard `dns_target` / `configure_domain`
  machinery. The record targets the publish's CID, not the IPNS name, so the domain
  cannot go dark when a record expires.
- Gateway-portable sites: root-absolute HTML links rewritten to depth-relative on upload
  (default on), so the same build renders on subdomain and path-form gateways alike.
- Local node start, with consent: detects an installed `ipfs`, says what running a
  background daemon means, then starts and watches it — a daemon that dies reports its own
  reason rather than a timeout. The gateway port is read from the node's config and checked
  before starting, since Kubo's default 8080 is the port moss's preview server holds; moss
  offers to move it, with your permission. Never downloads binaries — missing installs get
  an in-app explanation with an install link. `node_rpc` supports always-on remote nodes.
- Settings are moss's and read-only to the plugin; the plugin's own bookkeeping lives in
  `state.json` beside them.
- Optional **co-pin**: after a successful deploy, best-effort pin of the same CID to the
  other backend (never fails the deploy; only counted on an exact CID match).
