# Bluesky

Posts a copy of each new post on your moss site to your Bluesky account, linked back to the original, and moss writes the copy's address into the post's `syndicated:` list.

Name the channel for a folder of posts in its folder note:

```markdown
---
title: Notes
cascade:
  syndicate: [bluesky]
---
```

Then connect your account once. In the moss app, enter your handle and an app password in the channel's settings. Headless, put the handle in the plugin's settings and the app password in moss's secret store, which is outside the site folder:

```sh
printf '%s' 'xxxx-xxxx-xxxx-xxxx' | moss plugin secret set bluesky app_password ~/my-site
```

A post that fits in 300 characters is posted whole. A post written in parts, with a line holding only `---` between blank lines, is posted as a thread. Anything longer, and every titled article, is posted as its opening and a link card to the original.

A copy cannot be edited once posted, because Bluesky has no edit; moss says so when a post changes after its copy went out. Each copy has a record key derived from the post's note id and the channel, nothing an author edits, so a send that is interrupted and tried again lands on the same record rather than making a second post.

## Network access

- Your Bluesky server (`https://bsky.social` unless the `service` setting names another): `com.atproto.server.createSession` with your handle and app password, then `com.atproto.repo.createRecord`, `getRecord` and `deleteRecord` on your own repository.
- Nothing else. The plugin reads no page and calls no other service.
