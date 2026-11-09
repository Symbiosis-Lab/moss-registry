# LinkedIn

Posts a copy of each new post on your moss site to your LinkedIn profile, linked back to the original, and moss writes the copy's address into the post's `syndicated:` list.

Name the channel for a folder of posts in its folder note:

```markdown
---
title: Notes
cascade:
  syndicate: [linkedin]
---
```

Then connect your profile. In LinkedIn's developer portal, make an app and add the products Share on LinkedIn and Sign In with LinkedIn using OpenID Connect. Then make an access token with the token generator, with the scopes `openid`, `profile` and `w_member_social`. In the moss app, enter it in the channel's settings. Headless, put it in moss's secret store, which is outside the site folder:

```sh
printf '%s' 'the-access-token' | moss plugin secret set linkedin access_token ~/my-site
```

The token lasts 60 days, and LinkedIn offers no way to renew it outside its approved partners. When it has expired, moss reports the copy as refused for its credential, and you make a new one the same way.

LinkedIn posts carry no threads, and its API publishes no articles of its own, only posts. A post that fits in 3,000 characters is posted whole; a post written in parts is posted whole as one when it fits. Anything longer, and every titled article, is posted as its title, opening and link, with an article card for the original. The limit is checked on the text as written: LinkedIn reads `| { } @ [ ] ( ) < > # \ * _ ~` as markup, so each is sent escaped with a backslash, and a post within a few characters of the limit that uses many of them can be refused for its length.

When a post changes, its copy's text is edited in place; the card cannot change. LinkedIn lets an app look up a member's posts only with a permission it grants to approved partners, so a send that is interrupted cannot be checked: moss leaves it for you to confirm, by adding the copy's address to the post's `syndicated:` if it went out, or by running `moss deploy --retry-copies=linkedin` if it did not.

## Network access

- `https://api.linkedin.com`: `GET /v2/userinfo` for your member id, and `POST` and `DELETE` on `/rest/posts` for your own posts.
- Nothing else. The plugin reads no page and calls no other service.
