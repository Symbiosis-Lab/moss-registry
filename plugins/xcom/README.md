# X

Posts a copy of each new post on your moss site to your X account, linked back to the original, and moss writes the copy's address into the post's `syndicated:` list.

Name the channel for a folder of posts in its folder note:

```markdown
---
title: Notes
cascade:
  syndicate: [xcom]
---
```

Then connect your account once. X's API is paid per use, so set a spending limit in the developer console first. Make an app there with Read and write permission, and under Keys and tokens copy its API key and secret, then make an access token and secret for your own account. In the moss app, enter the four in the channel's settings. Headless, put each in moss's secret store, which is outside the site folder:

```sh
for key in api_key api_key_secret access_token access_token_secret; do
  printf 'value for %s: ' "$key"; read -r value
  printf '%s' "$value" | moss plugin secret set xcom "$key" ~/my-site
done
```

These are OAuth 1.0a credentials. X also offers OAuth 2.0 user tokens, but those expire after two hours, and a site that publishes from a script or a schedule has no one to sign in again; the four above do not expire until you revoke them.

A post that fits in 280 characters is posted whole, counted as X counts: every link as 23, and Chinese, Japanese, Korean and emoji characters as two. A post written in parts, with a line holding only `---` between blank lines, is posted as a thread of replies. Anything longer, and every titled article, is posted as its title, opening and a link to the original, which X shows as a card. Articles on X itself are not posted yet.

A copy cannot be edited once posted: X allows edits only in the first 30 minutes and makes each edit a new post, so moss says so when a post changes after its copy went out. A send that is interrupted is looked up among your latest posts before anything is posted again (two billed reads). A thread found cut short is taken down so it can be sent whole, and a copy found nowhere is sent again.

## Network access

- `https://api.x.com`: `POST /2/tweets` to post, `DELETE /2/tweets/{id}` to remove a copy, and, to look a copy up, `GET /2/users/me` and your own account's posts.
- Nothing else. The plugin reads no page and calls no other service.
