---
title: "Starter notes"
draft: true
---
# Making this site yours

This site starts as a society's own site: a course of reading, local circles on a map, a calendar of days, and notices, written in the body's collective voice. It is filled with the Chautauqua Literary and Scientific Circle's own pages from *The Chautauquan* (1882–85), so you can see a finished society site before you write about your own.

This file lives in `.moss/` on purpose, so it is never built as a page. Delete it whenever you like.

## What to replace

- `Chautauqua Literary and Scientific Circle.md` is the home page. It holds a still photograph as a full-width `:::hero`, the society's name and mottoes beneath it in a `{.masthead}` block, three stat tiles in a `:::grid 3 {.stats}`, and the three latest notices as a folder embed. Keep `home: true` in its frontmatter.
- `Course of Reading/` is a series: its pages have previous and next links.
- `Local Circles/` has a located page for each chapter. `location:` puts a page in the gazetteer (`.moss/places.toml`), and a `:::buttons` link on the folder page leads to the map at `/places/`.
- `Calendar/` lists the society's days. The days are dated pages (`date:` at day precision) and the folder page sorts them oldest first with `sort: date-asc`. One page carries `map: true`, which draws its own map.
- `Notices/` is not in the nav; the home page lists the latest and links to the rest.
- `About.md` is a `:::gallery` of photographs followed by a plain list of sources and licences. Rewrite the list for your own.
- Each section's `title:` is its nav label, so keep titles short. The longer name is the `#` heading in the folder page's body.

## How it is put together

- `.moss/config.toml` sets `header = "nav"`: a row of links with Home first and no site name.
- The theme is `.moss/theme/style.css` with its fonts beside it.
- Search and the RSS feed come with moss and need no setup.

## What belongs to whom

Every sentence is the Circle's own: the unsigned editorial department of the magazine, speaking as the Circle. Anything signed carries `author:` and `source:` in its frontmatter. The photographs are photochroms of about 1898 from the Library of Congress with no known restrictions, and a postcard scan from the New York Public Library; all of it is public domain in the United States. About lists the sources.
