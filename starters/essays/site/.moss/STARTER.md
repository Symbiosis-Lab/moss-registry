---
title: "Starter notes"
draft: true
---
# Making this site yours

This site starts as a writer's own site: essays, talks and an about page, in plain Markdown. It is filled with Virginia Woolf's public-domain writing (*The Common Reader*, First Series, 1925, and *A Room of One's Own*, 1929) so you can see a finished site before you write a word. Everything below is about replacing her with you.

This file lives in `.moss/` on purpose, so it is never built as a page. Delete it whenever you like.

## What to replace

- `Virginia Woolf.md` is the home page. Replace its body with your name and a line of your own. Keep `home: true` in its frontmatter; without it the front page becomes a feed of every page on the site.
- `Essays/` and `Talks/` hold the writing. Replace the files with your own. The numbered filenames (`01-`, `02-`, …) are what keep the folder in reading order; keep the habit, or add `sort:` to the folder's page.
- `About.md` and `assets/portrait.jpg` are the about page and its portrait. The list at the bottom of About names Woolf's books, editions and public-domain status; rewrite or delete it.
- `.moss/templates/essay.md` and `.moss/templates/talk.md` are bare frontmatter skeletons to copy from when you start a new page.

## How it is put together

- Each page is Markdown with `title`, `date` and `description` in its frontmatter. Essays and talks open with a one-line dateline, a single emphasised sentence that the theme sets as a small-caps masthead; delete it or keep the habit.
- `Talks/A Room of One's Own/` carries `series: true`, which is what gives its chapters previous and next links. A folder only gets them when it says so.
- `location:` on a page puts it in the gazetteer (`.moss/places.toml`); the two journey essays also carry `map: true`, which draws a map on the page. Remove either line and the map goes.
- `.moss/config.toml` sets `header = "nav"`: a plain row of links with no site name, and no footer. The nav order comes from `weight:` on `Essays/Essays.md`, `Talks/Talks.md` and `About.md`.
- The theme is `.moss/theme/style.css` with its fonts beside it: Fraunces for headings and Literata for text, both under the SIL Open Font License, with their licence files. One hue, two lightness stops, light and dark.

## What belongs to whom

Every sentence of body text is Woolf's, and the only words that are not are filenames and metadata. Both books are in the public domain in the United States (published before 1931) and wherever the term is life plus 70 years or less (Woolf died in 1941). The portrait is George Charles Beresford's photograph of 1902, credited in its alt text; Beresford died in 1938. About repeats the editions and the licence for readers of the site.
