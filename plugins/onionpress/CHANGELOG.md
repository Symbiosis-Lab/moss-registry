# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.4.0] - 2026-08-20

- Added: large sites upload without running the machine out of memory. The tar was previously sent as one raw request body, which buffered roughly twice its size in memory on the way out and again inside the receiver before the plugin's code ever ran; it is now streamed from disk as a multipart upload at constant memory. Gated on what the receiver reports it supports (`receiver_version` 1.2 or newer, checked numerically, with a missing or unreadable version treated as older): an older receiver keeps the exact request it always got, so nothing has to be upgraded in step. A 65 MB / 302-file publish was verified end to end on a cold stack.
- Changed: the plugin no longer raises its own status toasts. What happened travels back to moss as data in the hook's result, and moss renders it under the same rules as every other channel — which is what stops two different authors describing one publish on the same screen. A successful publish is deliberately silent from the plugin's side, because moss keeps watching after the hook returns and knows more than the plugin's bounded check ever could; failures still speak, since nothing runs afterwards to report them.
- Changed: the toast shown while the reachability check is still unresolved no longer opens with "Published." — it now reads "Checking whether your site is live…". Leading with "Published" was reporting success before verification: on a publish whose site never comes reachable, that premature claim was the only thing the user ever saw, because the follow-up liveness watch deliberately reports nothing but good news. Success wording still arrives only with the `live` verdict.
- Changed: a fresh install now pins OnionPress `v2.4.110-moss.1`. The previous pin was cut hours before the fix that lets a publish of any real size complete, so every stack installed from it could accept a site and then fail on it — PHP's memory limit never reached the running container, and the virtual machine's 1 GB default left the system killing large publishes rather than PHP reporting them. The stack now injects the limit at runtime and defaults to 2 GB.
- Changed: the stack is downloaded from `guoliu/onionpress`, the fork's new home, rather than through a redirect from its old one. Same asset, same checksum — this only stops a future release shipping a URL that works by redirect alone.

## [0.3.1] - 2026-08-12

- Changed: the plugin's preview status and companion-stack requirement now
  travel with it into the plugin registry. The 0.3.0 release was cut from a
  snapshot that predated the two manifest declarations, so its registry entry
  couldn't say either; this release exists to carry them (release artifacts
  are immutable — a manifest correction is always a new version).

## [0.3.0] - 2026-08-09

- Changed: the plugin now answers one question — is the site live, or is it
  not? — and never predicts. The old copy, "Published, but not reachable on Tor
  yet — the address should resolve within a minute", was a promise it had no
  way to keep; a user behind the GFW hit it during an outage where the address
  resolved neither within a minute nor at all. There are now three verdicts:
  live (a real Tor-routed fetch of the site succeeded), not live, and still
  checking — and "still checking" is never dressed up as either answer. An
  address answered by OnionHeaven failover reads as not live: it is a Wayback
  snapshot, not the site that was just published.
- Changed: every toast this plugin's deploy raises now carries a shared
  `onionpress-deploy` id, so moss can mute the set while a surface that
  already reports the outcome is on screen. On a first publish the wizard and
  the toast used to appear together, saying the same thing — except the wizard
  also carries the address, a copy button and "View on Tor". Ordinary
  publishes, where no wizard is open, still toast exactly as before.
- Added (moss#917): after `/commit`, wait (bounded, ~20s) for the receiver's
  own dual-probe Tor-reachability check to resolve before reporting the
  deploy complete — against a receiver new enough to send it
  (`receiver_version` 1.1+; older receivers are not polled at all, since they
  never send the field). Softens the "Published" toast/success-screen copy,
  without ever claiming failure, when the receiver confirms the address
  isn't reachable on Tor yet.
- Added (`0.1.0`): initial OnionPress deploy plugin. Publishes the sealed build
  generation to a locally-running OnionPress receiver over loopback HTTP,
  implementing the v1 wire contract (`receiver-contract.md`): port discovery via
  `GET /status`, `tar` of `.moss/build/current`, `POST /generation` upload,
  `POST /commit` atomic flip. Returns a `DeploymentInfo` with `method:
  "onionpress"` so moss persists the onion `site_url`. Transport is the
  `execute_binary` host-fn (`curl` + `tar`) — no new host-fn, no moss release.
