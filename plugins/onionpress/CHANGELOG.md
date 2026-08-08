# Changelog

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
