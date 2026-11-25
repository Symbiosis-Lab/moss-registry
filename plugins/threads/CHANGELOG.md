# Changelog

## 0.1.3

### Added

- The manifest lists the hosts the plugin contacts (`network`), so moss can refuse a request to any other host.

## 0.1.2

- Shows the Threads mark in moss instead of a letter.

## 0.1.1

- Tells moss which account it is signed in to, so copies posted from one account are left alone while another is signed in.

## 0.1.0

Add a preview Threads channel for short posts, reply threads and linked teasers, with manual access-token renewal, bounded container readiness, conservative UTF-16 shaping, reverse rollback on explicit refusals, and recovery that preserves uncertain publication outcomes. Include unit tests and a loopback syndication harness. Live API semantics and host redirect enforcement remain unverified; see README before live use.
