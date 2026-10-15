---
title: "Starter notes"
draft: true
---
# Making this site yours

This site starts as a writer's own site: essays, talks and an about page, in plain Markdown. It is filled with Virginia Woolf's public-domain writing (*The Common Reader*, First Series, 1925, and *A Room of One's Own*, 1929) so you can see a finished site before you write a word. Everything below is about replacing her with you.

This file lives in `.moss/` on purpose, so it is never built as a page. Delete it whenever you like.

## What to replace

- `index.md` is the home page. Replace its body with your name and a line of your own. Keep `home: true` in its frontmatter; without it the front page becomes a feed of every page on the site.
- `Essays/` and `Talks/` hold the writing. Replace the files with your own. The numbered filenames (`01-`, `02-`, …) are what keep the folder in reading order; keep the habit, or add `sort:` to the folder's page.
- `About.md` and `assets/portrait.jpg` are the about page and its portrait. The list at the bottom of About names Woolf's books, editions and public-domain status; rewrite or delete it.
- `.moss/templates/essay.md` and `.moss/templates/talk.md` are bare frontmatter skeletons to copy from when you start a new page.

## How it is put together

- Each page is Markdown with `title`, `date` and `description` in its frontmatter. `source:` records where a piece first appeared; it never shows on the page.
- `Talks/A Room of One's Own/` carries `series: true`, which is what gives its chapters previous and next links. A folder only gets them when it says so.
- `location:` on a page puts it in the gazetteer (`.moss/places.toml`); the two journey essays also carry `map: true`, which draws a map on the page. Remove either line and the map goes.
- `.moss/config.toml` sets `header = "nav"`: a plain row of links with no site name, and no footer. The nav order comes from `weight:` on `Essays/Essays.md`, `Talks/Talks.md` and `About.md`.
- The theme is `.moss/theme/style.css` with its fonts beside it: Fraunces for headings and Literata for text, both under the SIL Open Font License, with their licence files. One hue, two lightness stops, light and dark.

## Use this look on a site you already have

The stylesheet alone changes only the colours. The header, the home page and the fonts come from the other steps below, so do all five.

1. Copy the folder `.moss/theme/` from this site into the `.moss/` folder of your site, with the `fonts/` folder in it. Keep the `OFL-*.txt` files with the fonts: the font licence requires it.
2. In your site's `.moss/config.toml`, find the line `[site]` and add `header = "nav"` under it. If there is no `[site]` line, add both lines at the end of the file. Do not add a second `[site]` line.
3. In the frontmatter of your home page, add `home: true` and `children: false`. Without `children: false`, the home page lists your pages under your name.
4. Make the text of your home page a `#` heading with your name, then one paragraph. The theme makes the heading large and centred, and the paragraph italic.
5. A folder shows in the nav when its own page (for example `Posts/Posts.md`) has `nav: true` in its frontmatter. `weight:` sets the order, lowest first.

Then make the fonts and colours yours, in `.moss/theme/style.css`:

- Colours: change the four `--moss-color-` values in the `:root` block for light, and again in the `:root[data-theme="dark"]` block for dark. Keep body text at 7:1 contrast against the page, and the accent and muted colours at 4.5:1 or more.
- Fonts: put your `.woff2` files in `.moss/theme/fonts/`, point the `@font-face` blocks at the top of the file at them, and put their names in `--moss-font-heading` and `--moss-font-body`. A font you stop using can go, with its licence file.

## What belongs to whom

Every sentence of body text is Woolf's, and the only words that are not are filenames and metadata. Both books are in the public domain in the United States (published before 1931) and wherever the term is life plus 70 years or less (Woolf died in 1941). The portrait is George Charles Beresford's photograph of 1902, credited in its alt text; Beresford died in 1938. About repeats the editions and the licence for readers of the site.
