# @symbiosis-lab/moss-plugin-ipfs

> Publish moss sites to IPFS.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

A moss publishing plugin that pins your built site to IPFS and hands back a shareable
gateway URL. Two backends are supported behind one interface:

- **Pinata** (hosted pinning service) — moss asks for a Pinata API token the first time
  you publish, in its own credential window, and keeps it for you; the plugin only reads
  it.
- **Local Kubo node** — publish through your own node, no account required. If IPFS is
  installed but not running, moss offers to start it, after telling you what that means:
  the node keeps running once moss quits, and it does not come back by itself after a
  reboot. If it isn't installed, the plugin explains in-app and links the installer (it
  never downloads binaries silently). `node_rpc` can point it at an always-on node (NAS,
  Raspberry Pi, VPS) instead. A locally-kept site stays online only while the node runs —
  the plugin says so after every such deploy, and co-pinning to Pinata closes the gap.

Optionally publishes a stable **IPNS** name, so the URL you share doesn't change on every
publish. The name is derived from an ed25519 key moss holds (`getKey`/`signWithKey`), with
the record built and signed by the plugin (`src/ipns-record.ts`, validated live against a
Kubo node). Because the key is moss's rather than a backend's, switching between Pinata
and your own node keeps the same name.

Two things about IPNS are worth knowing before you rely on it.

**The record expires 48 hours after the publish that created it.** Nothing republishes it
in between — only your next publish does. If you publish weekly, the name resolves for the
first two days and then stops until you publish again. This is why a custom domain's
DNSLink record points at the publish's CID rather than at the name: a CID always resolves,
and moss shows you the new record each time you publish.

**The key lives in this project, and does not travel with your repo.** It is stored in
`.moss/keys/`, which moss gitignores deliberately — a keystore in a pushed repository is a
leaked permanent site identity. So a clone of your site on a second computer mints a *new*
key and therefore a new name. To publish the same site from two machines today, copy the
project's `.moss/keys/` directory across by hand, outside git.

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

The Pinata token is not a setting. It is declared in the manifest
(`contributes.deploy_target.setup.credentials`) and held by moss in its own secret store,
so moss's window is the only thing that ever asks for it and the plugin only reads it back
(`src/credentials.ts`). The store is app-global — a Pinata account is an account, not a
project — and the token is sent only to Pinata. When Pinata refuses it, the plugin tells
moss so, and the next publish asks you for a new one instead of failing the same way
forever.

Readiness is checked before a publish starts rather than in the middle of one: the manifest
says which credential this provider needs, and `check_setup` (`src/setup.ts`) answers what
a manifest cannot — is your node running, is its gateway port free, does the token still
work. moss draws every question and button that comes back.

Settings are read-only to the plugin: moss owns `config.json`, and the plugin's own
bookkeeping (the IPNS sequence, the last CID) lives beside it in `state.json`.

## Network access

Endpoints this plugin talks to, and why:

- `https://uploads.pinata.cloud/v3/files` — site upload (Pinata provider; JWT auth).
- `https://api.pinata.cloud/data/testAuthentication` — token check in the setup gate (Pinata).
- `<node_rpc>/api/v0/*` (default `http://127.0.0.1:5001`) — local provider: add,
  verification (`ls`), keys, IPNS `name/publish`, and identity-IPNS `routing/put`.
- your node's own gateway (its port is read from `Addresses.Gateway`, never assumed) /
  `https://dweb.link` / `https://ipfs.io` /
  `https://ipfs.filebase.io` — read-only gateway checks (structure verification and the
  informational liveness probe) and the View-site links surfaced to the user.
No other hosts are contacted. The `execute_binary` requirement covers detecting and
starting an already-installed Kubo (`ipfs version` / `ipfs init` / `ipfs config` / a
detached `ipfs daemon`) — the plugin never downloads binaries. It asks before starting a
daemon, and again before changing your node's gateway port. Site content is uploaded only to the provider(s) the user
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

This plugin is 0.x. Verified live (full deploy cycles through the real binary on both
providers, wire-level multipart capture, IPNS publish/resolve on a real Kubo node, public
gateway serving of Pinata-pinned deploys). It needs moss 0.11.7 or newer, the release that
draws plugin setup and holds plugin credentials. See
[CHANGELOG.md](./CHANGELOG.md).

## License

MIT — see [LICENSE](../../LICENSE).
