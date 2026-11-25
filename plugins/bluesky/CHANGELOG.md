# Changelog

## 0.2.1

### Added

- The manifest lists the hosts the plugin contacts (`network`), so moss can refuse a request to any other host.

## 0.2.0

- Your site's domain can be your Bluesky handle: set your account ID, and moss writes `/.well-known/atproto-did` on every build; then choose your domain as your handle in Bluesky. Needs moss 0.15.27.

## 0.1.2

- An interrupted send whose post is not on Bluesky is sent again once moss looks it up, with moss releases that send a copy again only when the network says outright it is not there.
- Tells moss which account it is signed in to, so copies posted from one account are left alone while another is signed in.

## 0.1.1

- The channel button shows the Bluesky logo.

## 0.1.0

- A preview (`"preview": true`): moss offers and installs it only for users who have turned on Preview features in its Settings.
- Posts each new post's copy to Bluesky through moss's syndication contract: short posts whole, posts written in parts as threads, longer posts and articles as their opening with a link card.
- Copies are found again rather than posted twice when a send is interrupted, and can be removed when their post is deleted.
