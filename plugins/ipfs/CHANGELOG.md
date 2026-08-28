# Changelog — moss-plugin-ipfs

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
