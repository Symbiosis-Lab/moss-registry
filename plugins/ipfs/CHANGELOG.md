# Changelog — moss-plugin-ipfs

## 0.1.0

Initial release.

- `deploy` to IPFS via **Pinata** (v3 Files API) or a **local Kubo node** (RPC), behind
  one provider interface; byte-identical CIDs across backends.
- Structure verification on first deploy per provider (Pinata: from the upload response;
  local: via RPC `ls`); a proven-broken tree fails the deploy loudly — never a silent
  broken site.
- Stable **IPNS**: identity-backed names derived from a moss-held ed25519 key
  (`getKey`/`signWithKey`; record built and signed in-plugin, published via Kubo
  `routing/put`), falling back to the local node's keystore on older moss builds, with a
  unique per-project key name.
- **DNSLink** custom-domain support via the standard `dns_target` / `configure_domain`
  machinery.
- Gateway-portable sites: root-absolute HTML links rewritten to depth-relative on upload
  (default on), so the same build renders on subdomain and path-form gateways alike.
- Zero-click local node: auto-detects `ipfs` on PATH, can download a pinned Kubo build
  via the host binary resolver, starts and waits for the daemon; `node_rpc` supports
  always-on remote nodes.
- Optional **co-pin**: after a successful deploy, best-effort pin of the same CID to the
  other backend (never fails the deploy; only counted on an exact CID match).
