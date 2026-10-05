# organisation

A society that publishes a programme, in the society's own collective voice: a course of reading, local chapters on a map, a calendar of days, a season of gatherings at a place, and many pages that are notices and reports rather than essays. The picker shows it as **Organisation**.

## What fills it, and why

The Chautauqua Literary and Scientific Circle's own editorial department, from *The Chautauquan* (1882–85), and its first Assembly years. Every sentence on a page is the Circle's; the registry's words are frontmatter only (`title`, `date`, `source`, `description`, `location`).

- Who writes: the unsigned editorial department of the magazine, speaking as the Circle. Anything signed carries `author:` and `source:`; the Founder, John H. Vincent, is credited by name as the Founder's voice and used only from his own book (*The Chautauqua Movement*, 1886).
- Why it publishes: to keep a scattered membership on one course of reading, to tell local circles what others do, and to call them to the memorial days and the August Assembly.
- Cadence: a monthly magazine, a yearly course of reading, an Assembly each August.

## Sections and what each one shows

The nav holds five one-word items: Home, Reading, Circles, Calendar, About. A section's `title:` is its nav label, so titles are short, and the full name ("Course of Reading", "Local Circles") is the `#` heading in the folder page's body. Every section keeps enough pages for its feature to show.

| Section | Pages kept | What it shows |
|---|---|---|
| Home | the home page | A still photograph as a full-width `:::hero` with nothing written on it, the society's name and three mottoes beneath it in a fenced div, stat tiles as a `:::grid 3 {.stats}`, and the three latest notices as a folder embed. |
| Reading (`Course of Reading/`) | the year's list and the first two monthly outlines | A series with previous and next between its pages. |
| Circles (`Local Circles/`) | six towns in six states | `location:` on every page, so the places map reads as a country rather than a cluster, and a `:::buttons` link to the map. |
| Calendar | the list of days, three memorial days, three Assembly days | Dated pages at day precision, oldest first through `sort: date-asc`. The Assembly pages are located and Recognition Day, 1882 carries its own map (`map: true`). |
| Notices | four, one per issue year plus the homily on regularity | Not in the nav; the home page lists the latest and links to the rest. |
| About | the page and its six pictures | The photographs as a `:::gallery`, then a plain list of sources and licences. |

Search and the RSS feed come with moss.

## Not shown, and why

Math, notebooks and film are absent: no public-domain film of Chautauqua exists before 1931, so the banner is one still photochrom. moss's `:::hero` can crossfade several images (one `![[image]]` per line), which this starter leaves unused, because the pictures would change without changing what the page says. A second language is absent too: this starter is English only.

## Licence

Public domain in the United States: publications of 1882 to 1898, all before 1931. The photographs are Detroit Publishing Co. photochroms of about 1898 from the Library of Congress with no known restrictions on publication, and a postcard scan from the New York Public Library on Wikimedia Commons. Coordinates in the gazetteer are from Wikidata. About states all of this for readers of the site. The materials of the present Chautauqua Institution are not used.
