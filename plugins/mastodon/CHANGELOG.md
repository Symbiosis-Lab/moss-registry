# Changelog

## 0.2.0

- Set your account, and every page links to your Mastodon profile with `rel="me"` (add your site's address to your profile to get the verified mark there) and credits you on link previews with `fediverse:creator`. Needs moss 0.15.27.

## 0.1.2

- Tells moss which account it is signed in to, so copies posted from one account are left alone while another is signed in.

## 0.1.1

- The channel button shows the Mastodon logo.

## 0.1.0

- A preview (`"preview": true`): moss offers and installs it only for users who have turned on Preview features in its Settings.
- Posts each new post's copy to Mastodon through moss's syndication contract: short posts whole, posts written in parts as threads of replies, longer posts and articles as their opening with a link to the original.
- Edits a copy in place when its post changes, looks an interrupted send up before posting again, and removes a copy when its post is deleted.
