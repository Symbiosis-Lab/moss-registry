# @symbiosis-lab/moss-plugin-onionpress

> Publish moss sites to a self-hosted OnionPress (.onion) receiver.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![status](https://img.shields.io/badge/status-experimental-orange)](../README.md#stability)

A moss deploy plugin that hands the sealed build generation to a locally-running
[OnionPress](https://github.com/Symbiosis-Lab) receiver, which serves it as a Tor
onion service. Deploy is loopback-only: the plugin probes for the receiver on
`127.0.0.1`, uploads a tar of `.moss/build/current`, and commits it.

The wire protocol between this plugin and the receiver is pinned in
[`receiver-contract.md`](../../receiver-contract.md) (repo root).

## How it works

On Publish, the `deploy` hook:

1. **Discovers** the receiver — probes `GET /status` on ports `8080, 18080,
   28080, 38080, 48080` and takes the first port whose JSON carries
   `receiver_version`. No receiver → a "Start OnionPress first" toast.
2. **Packs** the current generation — `tar -cf /tmp/moss-<ts>.tar -C
   .moss/build/current .` (follows the `current` symlink).
3. **Uploads** the tar — `POST /generation?id=moss-<ts>` as
   `application/x-tar`. A rejected upload aborts before commit.
4. **Commits** — `POST /commit` flips the live site and returns the onion URL.
5. **Cleans up** the temporary tar.

moss persists the returned onion URL as the site's `site_url` via the hook's
`DeploymentInfo` (`method: "onionpress"`).

Transport uses the sanctioned `execute_binary` host-fn (`curl` + `tar`) — the
same escape hatch the github plugin uses for git. No new moss host-fn and no
moss release are required.

## Network access

**No external hosts.** Every request this plugin makes goes to your own machine
over loopback:

- `http://127.0.0.1:<port>/wp-json/onionpress/v1` — the OnionPress receiver's
  REST namespace, probed on ports `8080, 18080, 28080, 38080, 48080`
  (multi-user installs offset the port by +10000 per user). Three endpoints are
  used: `GET /status` (discovery and liveness), `POST /generation` (upload the
  build tar), and `POST /commit` (flip the live site).

Requests are issued with `curl` through the `execute_binary` host function —
`curl` for transport and `tar` for packing the generation are the whole reason
this plugin declares `requires: ["execute_binary"]`.

The site's `.onion` address is never fetched from here. The receiver runs its
own Tor-routed reachability check and reports the outcome in `/status`; this
plugin only reads that field.

## Sideloading for a real test

See [SIDELOAD.md](./SIDELOAD.md).

## Stability

This plugin is 0.x. APIs may change between minor versions until 1.0.

## License

MIT — see [LICENSE](../LICENSE).
