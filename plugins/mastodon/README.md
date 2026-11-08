# Mastodon

Posts a copy of each new post on your moss site to your Mastodon account, linked back to the original, and moss writes the copy's address into the post's `syndicated:` list. It works with any server that offers the Mastodon client API, GoToSocial included.

Name the channel for a folder of posts in its folder note:

```markdown
---
title: Notes
cascade:
  syndicate: [mastodon]
---
```

Then connect your account once. On your server, make an application under Preferences, Development, with the scopes `read:statuses` and `write:statuses`, and copy its access token. In the moss app, enter your server's address and the token in the channel's settings. Headless, put the server in the plugin's settings and the token in moss's secret store, which is outside the site folder:

```sh
printf '%s' 'the-access-token' | moss plugin secret set mastodon access_token ~/my-site
```

A post that fits in 500 characters is posted whole, with every link counted as 23 characters, as Mastodon counts it. A post written in parts, with a line holding only `---` between blank lines, is posted as a thread of replies. Anything longer, and every titled article, is posted as its opening and a link to the original, which Mastodon shows as a card.

When a post changes, each status of its copy is edited in place. A thread can change its words but not its number of parts; moss says so if it does. A send that is interrupted is looked up among your recent statuses before anything is posted again: by its text, or a teaser by its link to the post. If no single status matches, or a thread is only partly there, moss asks you rather than risk a second copy.

## Network access

- Your server, at the address in the `server` setting: `POST`, `PUT` and `DELETE` on `/api/v1/statuses`, and, to look a copy up, `/api/v1/accounts/verify_credentials` your own account's statuses, and the replies under a thread's first status.
- Nothing else. The plugin reads no page and calls no other service.
