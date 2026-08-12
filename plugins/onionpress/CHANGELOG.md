# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
