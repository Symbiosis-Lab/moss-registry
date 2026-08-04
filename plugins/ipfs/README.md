# @symbiosis-lab/moss-plugin-ipfs

> Publish moss sites to IPFS.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

A moss publishing plugin that pins your built site to IPFS and hands back a shareable
gateway URL. Two backends are supported behind one interface:

- **Pinata** (hosted pinning service) — paste a Pinata JWT once; moss pins your site and
  keeps it available.
- **Local Kubo node** — publish through your own node, no account required. If no
  daemon is running, moss downloads a Kubo binary (via the host's binary resolver)
  and starts one for you; `node_rpc` can point it at an always-on node (NAS,
  Raspberry Pi, VPS) instead.

Optionally publishes a stable **IPNS** name (so the shared URL doesn't change on every
deploy) and can wire up a custom domain via **DNSLink**. On moss builds with the keystore
API, the IPNS name is **identity-backed**: derived from an ed25519 key moss holds
(`getKey`/`signWithKey`), with the record built and signed by the plugin
(`src/ipns-record.ts`, validated live against Kubo) — so the name is the same across
providers and machines. Older builds fall back to the local node's keystore.

## Configuration

Settings render in moss from the plugin manifest:

| Setting | Default | Meaning |
|---|---|---|
| IPFS Provider (`provider`) | `pinata` | `pinata` (hosted) or `local` (your Kubo daemon). |
| Custom Gateway Host (`gateway`) | _blank_ | Path-style gateway host for View-site links, e.g. `gateway.pinata.cloud`. Blank uses `dweb.link`. |
| Pin Name (`pin_name`) | site name | Label for the pin in your provider (falls back to `moss-site`). |
| Use IPNS (`use_ipns`) | `true` | Publish a stable IPNS name so your URL/DNSLink don't change each deploy. |
| Gateway-Portable Links (`relative_urls`) | `true` | Rewrite absolute HTML links to relative so the site renders on any gateway. |
| Node RPC Endpoint (`node_rpc`) | _blank_ | Kubo RPC for the local provider. Blank = this machine; set for a NAS/Pi/VPS node. |
| Co-Pin (`co_pin`) | `false` | Also pin each deploy to the other backend when available — same CID, one more keeper. |

The Pinata JWT is a secret and is stored per-project in a plugin cookie
(`src/credentials.ts`), never in `config.json`.

## Network access

Endpoints this plugin talks to, and why:

- `https://uploads.pinata.cloud/v3/files` — site upload (Pinata provider; JWT auth).
- `https://api.pinata.cloud/data/testAuthentication` — JWT pre-flight check (Pinata).
- `<node_rpc>/api/v0/*` (default `http://127.0.0.1:5001`) — local provider: add,
  verification (`ls`), keys, IPNS `name/publish`, and identity-IPNS `routing/put`.
- `http://127.0.0.1:8080` / `https://dweb.link` / `https://ipfs.io` /
  `https://ipfs.filebase.io` — read-only gateway checks (structure verification and the
  informational liveness probe) and the View-site links surfaced to the user.
- `https://dist.ipfs.tech/kubo/…` — one-time Kubo binary download, only when the local
  provider is selected, no daemon is running, and no `ipfs` binary is on PATH (via the
  host binary resolver; `requires: ["execute_binary"]`).

No other hosts are contacted. Site content is uploaded only to the provider(s) the user
configured.

## Architecture

Backends implement the `IpfsProvider` interface (`src/providers/types.ts`) and are
registered in `src/providers/index.ts` — adding a provider (e.g. web3.storage) is one
class plus one switch case. Deploy orchestration lives in `src/main.ts`: one multipart
directory upload (the host's encoder preserves directory paths — verified at the wire),
plus a one-time per-provider structure verification; a proven-broken tree fails the
deploy loudly rather than ever shipping a broken site. All HTTP goes through moss-api's
Rust-side helpers (`src/http.ts`) — never browser `fetch`.

## Development

```sh
npm ci
npm run build   # esbuild IIFE bundle → dist/
npm test        # vitest: unit + integration projects
```

The IPNS record test suite includes a live check that publishes a plugin-built record to
a local Kubo daemon and resolves it; it skips automatically when no daemon is reachable.

## Stability

This plugin is 0.x. Verified live against moss v0.7.21 (full deploy cycles through the
real binary on both providers, wire-level multipart capture, IPNS publish/resolve on a
real Kubo node, public gateway serving of Pinata-pinned deploys). See
[CHANGELOG.md](./CHANGELOG.md).

## License

MIT — see [LICENSE](../../LICENSE).
