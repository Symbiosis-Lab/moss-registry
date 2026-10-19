---
title: "Starter notes"
draft: true
---
# Making this site yours

This site is a project board drawn by **Projektschau for KERN**, Don Ludwig's project overview on the KERN UX standard ([github.com/donludwig/projektschau-kern](https://github.com/donludwig/projektschau-kern), [projektschau.thinkrepeat.com](https://projektschau.thinkrepeat.com)). It shows a programme as cards you can filter by area and kind, and as a timeline. The look is KERN's, the German public-sector design system by the KERN project ([kern-ux.de](https://www.kern-ux.de)), in its typeface, Fira Sans.

The pages are only an example filling: fifteen projects of the City of Vienna's municipal programme, 1919–1934, with their sources, in English and German. Replace them with your own projects.

This file lives in `.moss/` on purpose, so it is never built as a page. Delete it whenever you like.

## The first time you open the site

Projektschau runs as a plugin that came with this folder, in `.moss/plugins/projektschau/`. moss never runs code that came with a folder until you say so, so the first time you open the site it asks once, in a message naming Projektschau, with an **Allow** button. Until you allow it, the home page (and the German one) shows moss's own plain list of pages instead of the board; every other page looks as it will. After you allow it, the preview rebuilds with the board. The message's **Review plugins** button opens the list of plugins, where Projektschau can be allowed too.

## What to replace

- `index.md` is the home page and the board. `children_style: projektschau` draws every project below it as a card. `highlights:` names the projects shown first, as `[[links]]` to their pages. The band at the top is a heading, a paragraph and a picture in a `:::grid 2 3:2 {.home-band}` block. Keep `home: true` in its frontmatter.
- `Housing/`, `Health/`, `Welfare/`, `Sport/` and `Education & culture/` are the areas. Each area is a folder whose `index.md` sets the area's `color:` (a hex colour, from which the board derives its light and dark tints) and its `icon:`, one of `house`, `heart-pulse`, `users`, `trophy` and `book-open`. An area without a `color:` is left off the board.
- Each project is a page inside an area folder with these fields in its frontmatter:
  - `kind:` one of `Building`, `Service`, `Programme` and `Event`. The board's kind filter and the verb on each card come from it: Built, Founded, Introduced, Held.
  - `years:` a single year (`1922`), a span (`1927–1933`) or an open start (`"1923/.."`). The timeline is drawn from these. A page with a `kind:` and no `years:` is left off the board.
  - `figure:` optional, one line with a number in it, shown large on the card (`1,382 flats`).
  - `partners:` optional, a list of people or organisations, such as `[Karl Ehn]`.
- A project page's body is up to you; these have a paragraph, pictures with captions, a gallery and a `## Sources` list.
- `Partners/` has a page for every name a project lists under `partners:`, with `partners_page: true` and a `byline:` line. The board warns about a partner without a page, so add the page when you add the name.
- `de/` is the German edition: the same files again at the same paths, in German, pointing at the pictures in the English folders. `de/index.md` carries the German site name as its `title:`. A page without a German file is simply missing from the German board. Delete `de/` to keep the site in one language. The board's own words exist in English and German only, so a page in any other language draws the board in English.
- `About the sources.md` and `footer.md` (with `de/` copies) say where the words and pictures come from. Rewrite them for your own.

## How it is put together

- `.moss/config.toml` declares the board's fields: `kind` as a choice, `years` as a period and `figure` as a count, each `in` the five area folders and `de`. A new area folder must be added to those three `in` lists. `partners` is a term: each name links to the page in `Partners/` that has its title and `partners_page: true`.
- `.moss/plugins/projektschau/` holds Projektschau. `projektschau.js` and `projektschau.css` are Don Ludwig's renderer, unchanged. `main.js` and `engine-shim.js` port it to moss: they turn the area folders and project pages into Projektschau's data, draw the board while the site is built, and leave the browser to take over. The plugin's licence is the EUPL-1.2, in `LICENSE.txt`.
- `.moss/theme/` holds KERN's colours and the part of the KERN kit the board uses (`kern-board.css`), Fira Sans with its licence, and `script.js`, which keeps the board's dark mode in step with moss's light and dark switch.
- Search and the RSS feed come with moss and need no setup.

## What belongs to whom

Projektschau for KERN is Don Ludwig's work, under the EUPL-1.2. KERN is the KERN project's, under the EUPL-1.2. Fira Sans is the Mozilla Foundation's and Telefonica's, under the SIL Open Font License 1.1, and the area icons are Lucide's, under the ISC licence. Each licence is in the folder beside what it covers. The example's words are CC0. Its pictures are marked CC0 by the Wien Museum and the Rijksmuseum, Public Domain Mark by the Wienbibliothek im Rathaus, and public domain by the Austrian National Library; each caption names its holder and record.
