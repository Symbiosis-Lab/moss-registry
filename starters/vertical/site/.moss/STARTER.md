---
title: "Starter notes"
draft: true
---
# Making this site yours

This site starts as a single artist's catalogue in vertical Chinese typesetting, read from right to left: a home page, a chronology (年表), and three sections — 畫 paintings, 書 calligraphy and 文 writings — where each painting and calligraphy piece is a page with its image and the artist's own inscriptions, and each writing a page of text. It is filled with 八大山人 (Zhu Da, 1626–1705): 6 paintings, 1 calligraphy piece and 5 writings, so you can see a finished catalogue before you add a work of your own.

This file lives in `.moss/` on purpose, so it is never built as a page. Delete it whenever you like.

## What to replace

- `index.md` is the home page. Keep `home: true` in its frontmatter; replace the body and the highlight grid with your own.
- `畫/`, `書/` and `文/` are the sections. Each has an index page (`畫/畫.md` and so on) with `children_style: summary`, which lists its works as cards, and `series: true`, which gives the works previous and next links. Rename the folders for whatever you catalogue.
- Each work is a Markdown file with an image beside it, named after the work. `cover:` in its frontmatter names the image used for its card; the image itself is shown on the page.
- `年表.md` is a plain chronology page; replace or delete it.
- There is no site icon yet; add `assets/favicon.png` to give the site one.

## How it is put together

- `.moss/config.toml` sets `lang = "zh-hant"` and `typesetting = "vertical"`, which is what turns every page on its side. Remove the second line for horizontal text.
- `文/文.md` sets `sort: date`, so writings are listed oldest first.
- Inside a page, HTML comments hold the source notes for a transcription or a date. They are not shown on the site. Keep the habit for your own works.
- The theme is `.moss/theme/style.css`.

## Use this look on a site you already have

The stylesheet alone changes only the colours and a few gaps. The vertical text, the home page and the cards come from the other steps below, so do all six.

1. Copy the file `.moss/theme/style.css` from this site into `.moss/theme/` in your site. There are no font files: the stylesheet names Noto Serif TC, Source Han Serif TC and Songti TC, so a reader sees whichever of them their device has.
2. In your site's `.moss/config.toml`, find the line `[site]` and add these three lines under it: `lang = "zh-hant"`, `typesetting = "vertical"` and `implicit_figure = false`. If there is no `[site]` line, add it first. Do not add a second `[site]` line, and if one of the keys is already there, change it instead of repeating it. `typesetting` turns every page on its side, and without it the stylesheet's vertical rules do nothing; without `lang` the Chinese is set in the wrong face and spacing; without `implicit_figure = false` each image is wrapped in a figure that prints its alt text as a caption beside it. Use `lang = "zh-hans"` for Simplified Chinese.
3. In the frontmatter of your home page, add `home: true` and `children: false`. Without them the home page lists every page of your site under its text.
4. Shape your home page like this one: a few short lines of your own, with a backslash at the end of each line but the last to break it, then a `:::grid 3` block of wikilinks to your sections (`[[畫]]`, with `+++` between them), then a `:::grid {.summary}` block of wikilinks to single works. The theme turns the first grid into three cards and the second into a row of work cards, and leaves a wide gap between the lines and the first grid. Write each link with its folder, like `[[畫/雙鷹圖|雙鷹圖]]`, so it cannot match a file of the same name.
5. For each work, make the first block of its page a `::: {.plate}` block holding the image and, on the next line, a short note such as its size. The theme centres the note along the image, in the muted colour. Without the `{.plate}` block the note is in body colour and sits at the top of its line.
6. For each section, give the folder's own page (for example `畫/畫.md`) `children_style: summary` and a `cover:` naming one of its images, and give each work a `cover:` too. Without them the folder page loses its cards.

Then make the colours and typeface yours, in `.moss/theme/style.css`:

- Colours: change the five `--moss-color-` values in the `:root` block for light, and again in the `:root[data-theme="dark"]` block for dark. A colour set in one block and not the other stays light while the rest of the page goes dark.
- Typeface: change the names in `--moss-font-heading` and `--moss-font-body`. To ship a font with the site, put its `.woff2` in `.moss/theme/fonts/`, add an `@font-face` block that points at it, and keep its licence file beside it.

## Images

Every image is a JPEG at most 1600 pixels on its long edge. That keeps the whole site small enough to sync and publish quickly; keep your own pictures to the same budget.

## What belongs to whom

The artist died in 1705, so the paintings, calligraphy and writings are in the public domain. The pictures are reproductions, and only reproductions with clear reuse terms are here: the Metropolitan Museum of Art's Open Access images, the National Palace Museum's open data under CC BY 4.0, which must be credited (the credit is in the `colophon:` line of 傳綮寫生冊, which the site shows in the page footer), and files on Wikimedia Commons tagged PD-Art. Each work's page records its source in an HTML comment. The words around the works are the artist's own inscriptions and the titles and dates a catalogue needs. When you add your own works, record where each picture comes from and on what terms you may use it.
