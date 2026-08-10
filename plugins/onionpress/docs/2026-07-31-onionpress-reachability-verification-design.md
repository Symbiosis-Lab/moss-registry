# OnionPress: verify actual reachability before declaring "Published"

Design pass for moss#917 part 2. Part 1 (relax the Tor Browser fallback) shipped
separately in the same session — see `src-tauri/src/system/stack_install.rs`'s
`open_onion_url`.

## Problem

The OnionPress deploy plugin (`plugins/onionpress/src/main.ts`) shows the
"Published to your onion site." toast — and the publish modal's success
screen shows "Your onion site is live / Reachable on the Tor network" — as
soon as `POST /commit` returns from the local receiver. That call only proves
the receiver flipped its generation pointer; it says nothing about whether
the hidden-service descriptor is currently published in the live Tor
network.

Confirmed live 2026-07-31: when the descriptor isn't fresh, OnionHeaven's hub
302s visitors to a Wayback mirror. For a brand-new site, Wayback has nothing
archived, so a visitor who clicks the address seconds after "Published" sees
"not archived yet."

## What already exists (researched in the sibling `onionpress` receiver repo)

- **Reachability probing is already implemented**, just not surfaced over the
  wire. `src/onionpress/health.py`'s `check_external_reachability()` does a
  dual Tor-routed probe (`curl --socks5-hostname 127.0.0.1:9050 http://<addr>/`
  via two independent circuits) and populates `HealthResult.tor_externally_reachable`
  / `.external_http_code`. It also recognizes the exact #917 failure mode: a
  takeover response carries `X-OnionHeaven-Takeover: 1`, which the health
  check already treats as a negative signal, not a false positive.
- **`write_status()` drops these fields** before they reach
  `~/.onionpress/status.json` (and from there the WP receiver's `/status`
  endpoint) — `tor_externally_reachable`/`external_http_code` are computed
  and then discarded.
- **`bootstrap_pct` is the precedent** for exactly this kind of plumbing: added
  to `status.json` by `onionpress-service.py`, mirrored into the WP
  container, read by `onionpress_moss_bootstrap_pct()` in the receiver
  plugin, exposed on `/status`, and consumed on the moss side in
  `stack_install.rs` (`OnionStatus.bootstrap_pct`, moss#910). A reachability
  field can follow the identical path.
- **Tor's control port (9051) is not host-exposed** (container-internal only,
  reached today via `docker exec … nc`), and no `HS_DESC UPLOADED`
  event-streaming code exists. Building this would be new work on both sides
  and — per `health.py`'s own reasoning — `HS_DESC UPLOADED` proves the
  descriptor was *uploaded*, not that a client can currently *fetch* it,
  which is strictly less informative than the probe that already exists.
- **The Tor SOCKS port (9050) is already published to the host**
  (`docker-compose.yml`, `${ONIONPRESS_SOCKS_PORT:-9050}:9050`), so moss
  itself could in principle curl the onion address directly via
  `--socks5-hostname 127.0.0.1:9050` without any receiver change. This uses
  the same Tor instance that hosts the service, though — a self-probe, blind
  to the third-party-descriptor-lookup failures `check_external_reachability`
  was written to catch. It also assumes a fixed/discoverable SOCKS port per
  instance, which the receiver's multi-instance port-offset scheme
  (8080/18080/28080/…) suggests is not guaranteed to be 9050 for every user.

## Recommendation: surface the receiver's existing check, don't rebuild it

Extend `/status` the same way `bootstrap_pct` was added, rather than having
moss re-implement Tor-routed probing or wire up control-port event streaming:

1. **Receiver repo** (`onionpress`): stop dropping `tor_externally_reachable`
   / `external_http_code` in `write_status()`; add them to `status.json` as
   `onion_reachable: bool | null` and `onion_http_code: number | null` (`null`
   while the check hasn't completed yet — the probe takes real time, it must
   not block `/commit`). Bump `receiver_version`. Update
   `receiver-contract.md` (currently silent on reachability) with the new
   fields, mirroring how `bootstrap_pct` is documented there.
2. **moss side**: extend `OnionStatus` (`plugins/onionpress/src/onionpress-commands.ts`)
   and `stack_install.rs`'s receiver-status parsing with the two optional
   fields — same optional/absent-tolerant pattern already used for
   `bootstrap_pct` (a receiver build too old to have it must not break
   moss).
3. **Deploy flow** (`plugins/onionpress/src/main.ts`): after `commitGeneration`
   succeeds, poll `/status` (short interval, bounded total wait — the probe
   in `health.py` is itself circuit-bound, so this needs a sane timeout, not
   an indefinite spin) until `onion_reachable` resolves to `true`/`false`, or
   the timeout elapses with it still `null`/unresolved. Wire the three
   outcomes to distinct toast/success-screen copy:
   - `true` → today's copy stands: "Published to your onion site." /
     "Reachable on the Tor network."
   - `false` (explicit takeover/unreachable) → don't claim reachability;
     tell the user the descriptor hasn't propagated yet and the address
     will resolve shortly, without calling it a failure (the site's local
     health IS confirmed — see `showViewError`'s existing framing in
     `onionpress-publish-modal.ts`, which already treats "published but the
     view step failed" as distinct from "publish failed").
   - timeout / older receiver without the fields → fall back to today's
     behavior (local-health-only claim), but soften "Reachable on the Tor
     network" to something like "Publishing to Tor…" that doesn't overclaim.
4. Frontend strings to touch: `onionpress.success.subline` /
   `onionpress.claim.subline` in `frontend/app/i18n/ui-strings.ts` (all three
   locales), plus the toast text in `plugins/onionpress/src/main.ts`.

## What this explicitly defers

- Live verification against a real `.onion` address needs a working Tor
  circuit; per #917 this happens on the Linux dev box (`hel`) with a real
  Docker OnionPress stack, not in this design pass. #918 tracks the full
  install → publish → verify-reachable pass on the real Mac stack.
- Any change to `write_status()` / `/status` / `receiver-contract.md` is
  scoped to the `onionpress` receiver repo, not this one — implementation
  there is a separate PR from the moss-side polling/copy changes, same as
  every other receiver-contract change (moss#910's `bootstrap_pct` shipped
  as two coordinated PRs across the two repos).
- The bounded-poll timeout value and exact copy strings are left
  unspecified here — pick them when implementing against a real receiver on
  `hel`, where the actual descriptor-publish latency can be observed rather
  than guessed.
