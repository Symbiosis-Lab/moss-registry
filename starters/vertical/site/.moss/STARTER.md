---
title: "Starter notes"
draft: true
---
# Making this site yours

This site starts as a single artist's catalogue in vertical Chinese typesetting, read from right to left: a home page, a chronology (年表), and three sections — 畫 paintings, 書 calligraphy and 文 writings — where each painting and calligraphy piece is a page with its image and the artist's own inscriptions, and each writing a page of text. It is filled with 八大山人 (Zhu Da, 1626–1705): 6 paintings, 1 calligraphy piece and 5 writings, so you can see a finished catalogue before you add a work of your own.

This file lives in `.moss/` on purpose, so it is never built as a page. Delete it whenever you like.

## What to replace

- `八大山人.md` is the home page. Keep `home: true` in its frontmatter; replace the body and the highlight grid with your own.
- `畫/`, `書/` and `文/` are the sections. Each has an index page (`畫/畫.md` and so on) with `children_style: summary`, which lists its works as cards, and `series: true`, which gives the works previous and next links. Rename the folders for whatever you catalogue.
- Each work is a Markdown file with an image beside it, named after the work. `cover:` in its frontmatter names the image used for its card; the image itself is shown on the page.
- `年表.md` is a plain chronology page; replace or delete it.
- There is no site icon yet; add `assets/favicon.png` to give the site one.

## How it is put together

- `.moss/config.toml` sets `lang = "zh-hant"` and `typesetting = "vertical"`, which is what turns every page on its side. Remove the second line for horizontal text.
- `文/文.md` sets `sort: date`, so writings are listed oldest first.
- Inside a page, HTML comments hold the source notes for a transcription or a date. They are not shown on the site. Keep the habit for your own works.
- The theme is `.moss/theme/style.css`.

## Images

Every image is a JPEG at most 1600 pixels on its long edge. That keeps the whole site small enough to sync and publish quickly; keep your own pictures to the same budget.

## What belongs to whom

The artist died in 1705, so the paintings, calligraphy and writings are in the public domain. The pictures are reproductions, and only reproductions with clear reuse terms are here: the Metropolitan Museum of Art's Open Access images, the National Palace Museum's open data under CC BY 4.0, which must be credited (the credit is in the `colophon:` line of 傳綮寫生冊, which the site shows in the page footer), and files on Wikimedia Commons tagged PD-Art. Each work's page records its source in an HTML comment. The words around the works are the artist's own inscriptions and the titles and dates a catalogue needs. When you add your own works, record where each picture comes from and on what terms you may use it.
