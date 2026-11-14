# Substack

Hands each article on your moss site to your Substack publication, linked back to the original. Substack has no way for a program to post, so you publish in Substack's own editor, inside moss.

Set the publication's address in the channel's settings, such as `https://example.substack.com`, or its own domain if it has one, and name the channel for a folder of articles in its folder note:

```markdown
---
title: Writing
cascade:
  syndicate: [substack]
---
```

After the site is published, moss's panel shows the article with one button, Copy and open Substack. Press it: the article is copied with its headings, links and pictures, and your publication's editor opens in the panel. Sign in there the first time. Type the title, paste into the body, check it, and publish with Substack's own choices (web only, or by email as well). Close the panel.

On a later publish moss reads your publication's feed, finds the post that links back to the page, and writes its address into the page's `syndicated:` list. With `link_back` off there is no link to find it by: add the address to `syndicated:` yourself.

Check tables, footnotes and pictures after pasting.

## Network access

- Your publication's address: `GET /feed`, its public feed, to find the published post.
- Nothing else. The editor opens in moss's panel, and the plugin reads no page.
