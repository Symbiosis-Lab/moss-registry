# Syndication harness

Checks a syndication plugin end to end: real moss, headless, publishing a small site and posting its copies to a local copy of each network, then reading the copies back from that network.

```sh
for p in bluesky mastodon linkedin xcom; do (cd plugins/$p && npm ci && npm run build); done
cd harness/syndication && npm ci
node run.mjs --moss /path/to/moss [--only bluesky,linkedin] [--keep]
```

It needs Node 24 or later (the AT Protocol development network's native modules have no build for Node 23) and, for the networks that run in a container (Mastodon), Docker.

What one run does:

1. Makes a scratch folder with its own `HOME`, so no credential, approval or cache of yours is read or written.
2. Starts each network's local copy and a test account on it, and serves the site's build on a local port.
3. Writes a site: a folder of short posts and a folder of essays, both naming every channel under test with `cascade: syndicate:`, a deploy plugin that only reports the local address, and each channel plugin from its `dist/`. Credentials go in through `moss plugin secret set`, as an author's would.
4. Runs `moss deploy --dry-run --json` and keeps the copies it plans: each copy's form and the exact text of each part.
5. Runs `moss deploy`, and checks that each network holds exactly those copies, threads as replies in order, links marked as links, teasers with a card to the original, and that each post's `syndicated:` lists its copy.
6. Runs `moss deploy` again and checks that no network gained a post.
7. Edits two posted notes and runs `moss deploy` once more: a network that edits its posts (Mastodon, LinkedIn) must hold the edited text in the same posts, and moss must say the copy cannot change on one that does not (Bluesky, X). No network gains a post.
8. Makes the thread's copy look like a send whose answer was lost, as moss records one (its copy record unconfirmed, with no address, and nothing written back into the post), and runs `moss deploy` again: Bluesky and Mastodon must find every part of the copy without posting, and moss must ask the author where the channel cannot be sure (LinkedIn has no lookup; X's copy kept the words the edit changed).
9. Stops every network and server it started, and removes the scratch folder unless `--keep`.

Exit status 0 means every check passed; each check prints one line.

## Adding a network

A network is one file, `providers/<plugin id>.mjs`, exporting `start()`, which starts the network's local copy and returns:

- `config`: the plugin's settings for the test account (written to the plugin's `config.json`);
- `secrets`: its credentials, by the keys its manifest declares;
- `verify(copies, check)`: reads the network and calls `check(ok, what)` for each planned copy;
- `count()`: how many posts the account has, for the second-publish check;
- `owns(frontMatter)`: whether a post's front matter lists a copy on this network;
- `edits`: whether the network edits a post in place, so the plugin offers `update_copy`;
- `recovers`: after a lost answer, `"adopt"` where the lookup finds the copy, `"ask"` where moss must ask the author;
- `stop()`.

| Network | Local copy |
|---|---|
| Bluesky | the AT Protocol development network (`@atproto/dev-env`): a PLC directory and a data server, in process |
| Mastodon | GoToSocial (`superseriousbusiness/gotosocial:0.20.2`) in Docker, which speaks the Mastodon client API: the author signs in through the server's own OAuth pages, and a second account follows the author and must see each copy on its home timeline. The container is stopped by its id. |
| LinkedIn | a stand-in for the Posts API in process, written from LinkedIn's API reference: LinkedIn has no test environment, and its development tier posts to the live network. It requires the version and protocol headers, posts only as the token's own member, refuses commentary with an unescaped reserved character, and holds 3,000 characters as the limit. |
| X | a stand-in for the v2 posting API in process, written from X's API reference: X has no test environment, and every real post is billed. It checks each request's OAuth 1.0a signature with Node's own HMAC, refuses a post over 280 weighted characters, a duplicate, or a reply to a post it does not hold, and shortens links as X does. |

Deleting a copy, and undoing a thread that fails part-way, are covered by each plugin's unit tests, not here: moss 0.15.19 has nothing that asks a channel to delete a copy.

The two stand-ins are not recorded responses: nothing was recorded from either network. They hold the request and response shapes the API references document, so a live run on a test account is what confirms those shapes.
