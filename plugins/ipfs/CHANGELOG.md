# Changelog — moss-plugin-ipfs

## 0.2.0

- moss now asks for your Pinata token, in its own window, before a publish starts —
  the plugin no longer draws a field for it, and no longer keeps it in a cookie. The
  token lives in moss's secret store, shared across the projects you publish from. A
  token Pinata has stopped accepting is reported back to moss, so the next publish asks
  you for a new one instead of failing the same way every time.
- Anything that has to be arranged before publishing is now asked before the publish,
  not halfway through it: whether your IPFS node is running, whether its gateway port is
  free, whether the stored token still works. moss draws the questions and the buttons,
  including the line about what running a node on your computer costs you, before the
  click rather than after it.
- Your site's addresses — the CID, the IPNS name, each gateway, a custom domain — are
  handed to moss as data. moss lists them when you publish and keeps them in the deploy
  tab afterwards, instead of the plugin popping its own summary window once.
- Requires moss 0.11.7 or newer.

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
