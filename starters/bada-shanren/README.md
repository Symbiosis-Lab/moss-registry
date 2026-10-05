# bada-shanren

A single artist's catalogue in vertical Chinese typesetting, read from right to left: a home page, a chronology (年表), and three sections, 畫 (paintings), 書 (calligraphy) and 文 (writings). Each painting and calligraphy piece is a page with its image and the artist's own inscriptions; each writing is a page of text. The picker shows it as **Vertical**.

## What fills it, and why

八大山人 (Zhu Da, 1626–1705). The full site this starter is cut from catalogues 59 works. This cut keeps 12 and the chronology: 6 paintings, 1 calligraphy piece and 5 writings. Works whose reproductions lack clear reuse terms were left out of the starter on purpose, so the selection is the works whose images can be shown with their terms stated, not a ranking of the artist's work.

## Selection

- 畫, 6 paintings: 雙鷹圖, 荷花禽鳥圖, 山水冊, 傳綮寫生冊 (nine of its fifteen leaves), 河上花圖 and 魚石圖卷. They span 1677 to 1702 and give the home page its featured list and the folder its cards.
- 書, 1 calligraphy piece: 蘭亭序. The folder is a single page, so it shows the section's card and page but no previous and next.
- 文, 5 writings: 河上花歌, 與石濤書 and three letters from the thirteen-letter album 致方士琯十三札 (專使促駕, the earliest datable of them, 1689; 只手少甦; 窮變得意處). The letters and 與石濤書 are kept as text pages: each is a few lines, complete without its scan, so `fixups.sh` removes the scan's embed and cover and the comment notes about it. The letters sit in a series folder, so they carry previous and next; the album's index page is kept with its `sort:` list trimmed to the three present.

## Links, images and fixups

Every `[[…]]` link and every `cover:` and image path resolves inside the starter. `fixups.sh` repoints what the full site pointed at pages and images that are not here: the home page's cover and featured list, and the covers of 畫 and 文. It also turns the one link that does not resolve even in the full site (a note naming a page renamed long ago) into the bare word, de-links any other link to a page not in the cut, and sets `series: true` on the three folder pages so previous and next appear across their small folders. There is no site icon: the full site's was a crop of a work left out.

All 23 images are normalised to a long edge of 1600 px, JPEG quality 82, progressive, 4:2:0. 河上花圖.jpg is a 27:1 handscroll panorama (38324x1400 at source) that a long-edge limit reduces to 1600x58, which is within the budget but too short to read as a scroll; capping very wide scrolls by their short edge would be a better rule, and it has not been done.

## Structure

Every catalogue page carries `cover:` where it has an image, and each folder's index page carries `children_style: summary` and `series: true`. `文/文.md` also carries `sort: date`, to list writings oldest first. `.moss/config.toml` keeps `schema_version`, `lang = "zh-hant"`, `typesetting = "vertical"` and `implicit_figure = false`.

## Licence

The artist died in 1705, so the paintings, calligraphy and writings are in the public domain. What needs a basis is the photograph of each work, and only reproductions with clear reuse terms are in the starter. Each page also records its source in an HTML comment.

| Work | Source | Terms |
|---|---|---|
| 書/蘭亭序 and its cover crop | Metropolitan Museum of Art, Open Access (object 49144, 1989.363.136) | Public domain, CC0 (`isPublicDomain`) |
| 畫/山水冊 | Metropolitan Museum of Art, Open Access (object 49145) | Public domain, CC0 (`isPublicDomain`) |
| 畫/荷花禽鳥圖 and its cover crop | Metropolitan Museum of Art, Open Access (object 49143, 1989.363.135) | Public domain, CC0 (`isPublicDomain`) |
| 畫/雙鷹圖 | Metropolitan Museum of Art, Open Access (object 39540, 2014.721) | Public domain, CC0 (`isPublicDomain`) |
| 畫/傳綮寫生冊, 9 leaves | National Palace Museum, Taipei, Open Data | CC BY 4.0, credit required |
| 文/河上花歌, 4 images | Wikimedia Commons, 清 朱耷 河上花圖 跋文 1 1 to 1 4 (Tianjin Museum) | PD-Art |
| 畫/河上花圖 (the scroll, its cover and the poem detail) | Wikimedia Commons, 清 朱耷 河上花圖卷 HX1 to HX21, with one segment from the Commons file 八大山人 河上花图 | PD-Art; the other file is tagged Public domain |
| 畫/魚石圖卷 | Wikimedia Commons, Bada Shanren, Fish and Rocks, 1953.247, Cleveland Museum of Art | PD-Art, Public domain (checked against the Commons API) |

CC BY 4.0 requires attribution. The credit for the National Palace Museum leaves is the `colophon:` line of 畫/傳綮寫生冊, which moss shows in the page footer; keep it with the images wherever they are reused. PD-Art is Wikimedia's position that a faithful reproduction of a public-domain two-dimensional work creates no new copyright; it may not hold in every country, so check before reusing those images outside this starter.
