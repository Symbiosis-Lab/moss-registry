---
title: "Exploring Decentralized Publishing: A Test Article"
uid: 6aef0cb6
date: 2025-02-10
tags:
  - web3
  - publishing
  - decentralization
  - test
description: A comprehensive test article for validating Matters syndication with rich markdown content including code, quotes, lists, and more.
---

## Introduction

This article tests the full syndication pipeline from a local moss project to [Matters](https://matters.icu), a decentralized publishing platform built on IPFS. The goal is to verify that all markdown elements render correctly after conversion to HTML.

## Why Decentralized Publishing Matters

Traditional publishing platforms come with **inherent risks**: content can be censored, servers can go down, and users don't truly *own* their work. Decentralized platforms address these issues by:

1. Storing content on **distributed networks** like IPFS
2. Giving authors **cryptographic ownership** of their publications
3. Enabling **peer-to-peer** content distribution
4. Providing **censorship resistance** through redundancy

> "The internet was designed to be decentralized. We're simply returning to first principles."
> -- Tim Berners-Lee

## Technical Deep Dive

The syndication process works through a POSSE (Publish Own Site, Syndicate Elsewhere) workflow:

### Step 1: Content Processing

The plugin reads local markdown files and converts them to HTML using a custom converter. Here's a simplified example of the conversion pipeline:

```python
def convert_article(markdown_content: str) -> str:
    """Convert markdown to Matters-compatible HTML."""
    html = markdown_to_html(markdown_content)
    html = rewrite_image_urls(html)
    html = add_canonical_link(html)
    return html
```

### Step 2: Draft Creation

After conversion, the plugin creates a draft on Matters via the GraphQL API:

```graphql
mutation PutDraft($input: PutDraftInput!) {
  putDraft(input: $input) {
    id
    title
    content
    publishState
  }
}
```

### Step 3: User Review & Publish

The draft opens in a browser window for review. The user can:

- Edit the title and summary
- Add or modify tags
- Upload a cover image
- Click **Publish** when ready

### Step 4: Content Addressing

Each syndicated revision is content-addressed, so the identifier of a revision
is the hash $h = H(c)$ of its bytes $c$. Storage cost across $n$ revisions of a
document is therefore bounded by the number of *distinct* blocks:

$$
\mathrm{cost}(n) = \sum_{i=1}^{n} |B_i \setminus \bigcup_{j<i} B_j|
$$

For a multi-line derivation the line structure has to survive syndication too:

$$
\begin{align}
S_t &= \sum_{i \le t} \phi(k_i) v_i^\top \\
z_t &= \sum_{i \le t} \phi(k_i)
\end{align}
$$

A LaTeX comment must never be allowed to eat the line that follows it:

$$
\mathrm{dedup} = 1 - \frac{|U|}{\sum_i |B_i|} % ratio of unique to total
\quad\text{where } U = \bigcup_i B_i
$$

Note that $50 \%$ of a corpus being duplicate is common, and the escaped
percent above is a literal sign, not a comment.

## Feature Checklist

Here's what we're testing with this article:

- [x] Basic paragraphs and text formatting
- [x] Headings (H2, H3)
- [x] Bold and italic text
- [x] Ordered and unordered lists
- [x] Code blocks with syntax highlighting
- [x] Blockquotes
- [x] External links
- [x] Horizontal rules
- [ ] Image embedding (requires separate test)

---

## Conclusion

If you're reading this on Matters, the syndication was successful. The article was originally published on a local test site and automatically syndicated using the moss Matters plugin.

For more information about moss, visit the [project repository](https://github.com/nicholasgasior/gostatic).
