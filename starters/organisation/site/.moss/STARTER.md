---
title: "Starter notes"
draft: true
---
# Making this site yours

This site starts as a society's own site: a course of reading, local circles on a map, a calendar of days, and notices, written in the body's collective voice. It is filled with the Chautauqua Literary and Scientific Circle's own pages from *The Chautauquan* (1882–85), so you can see a finished society site before you write about your own.

This file lives in `.moss/` on purpose, so it is never built as a page. Delete it whenever you like.

## What to replace

- `index.md` is the home page. It holds a still photograph as a full-width `:::hero`, the society's name and mottoes beneath it in a `{.masthead}` block, three stat tiles in a `:::grid 3 {.stats}`, and the three latest notices as a folder embed. Keep `home: true` in its frontmatter.
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

## Use this look on a site you already have

The stylesheet alone changes only the colours. The header, the home page and the fonts come from the other steps below, so do all five.

1. Copy the folder `.moss/theme/` from this site into the `.moss/` folder of your site, with the `fonts/` folder in it. Keep the `OFL-*.txt` files with the fonts: the font licence requires it.
2. In your site's `.moss/config.toml`, find the line `[site]` and add `header = "nav"` under it. If there is no `[site]` line, add both lines at the end of the file. Do not add a second `[site]` line.
3. In the frontmatter of your home page, add `home: true` and `children: false`. Without them the home page lists every page of your site under its text.
4. Shape your home page like this one. Under the frontmatter, put an image in a `:::hero {full}` block for the full-width banner. Then put your name as a `#` heading, with a line or two of motto under it, inside a `::: {.masthead}` block: the theme centres the block, makes the heading large and sets the lines in italic. Then, if you want the numbers, a `:::grid 3 {.stats}` block of three tiles, each a bold number, a blank line and a short phrase, with `+++` between tiles. Read `index.md` here and copy its shape. Leave a part out and only that part goes: without the masthead block the heading is small and left-aligned and without the grid the numbers are gone.
5. A folder shows in the nav when its own page (for example `Posts/Posts.md`) has `nav: true` in its frontmatter. `weight:` sets the order, lowest first. Without `nav: true` the folder is missing from the header.

Then make the fonts and colours yours, in `.moss/theme/style.css`:

- Colours: change the `--moss-color-` values in the `:root` block for light, and again in the `:root[data-theme="dark"]` block for dark. Keep body text at 7:1 contrast against the page, and the accent and muted colours at 4.5:1 or more.
- Fonts: put your `.woff2` files in `.moss/theme/fonts/`, point the `@font-face` blocks at the top of the file at them, and put their names in `--moss-font-heading` and `--moss-font-body`. A font you stop using can go, with its licence file.

## What belongs to whom

Every sentence is the Circle's own: the unsigned editorial department of the magazine, speaking as the Circle. Anything signed carries `author:` and `source:` in its frontmatter. The photographs are photochroms of about 1898 from the Library of Congress with no known restrictions, and a postcard scan from the New York Public Library; all of it is public domain in the United States. About lists the sources.
