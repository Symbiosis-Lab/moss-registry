# essays

A writer's own site: essays, talks and an about page, in plain Markdown. It is the plainest answer to "I write essays and give talks, and I want them in one place with an about page." It is not a scholarly edition and not a tribute; it is what a working writer's site looks like when the writing already exists and the site's only job is to hold it in order.

The picker shows it as **Essays**.

## What fills it, and why

Virginia Woolf, in her own voice. Every sentence of running text on every page is hers, verbatim, from *The Common Reader* (First Series, 1925) and *A Room of One's Own* (1929), taken from public-domain Project Gutenberg texts. The only words that are ours are structural: folder names, filenames and the metadata fields the schema allows. No sentence of body text may be written in the registry's voice, anywhere, including captions, descriptions and the home page.

Dates, venues and credits are metadata, not prose, so they are allowed. Each essay and chapter opens with a one-line dateline (first publication venue and date) written as a single emphasised sentence, which the theme sets as a small-caps masthead. A day is stated only where the date is confirmed from a primary source; otherwise the dateline carries the year alone, and one essay carries a year with no venue because its venue was never confirmed. The six chapters of the book all carry the same combined dateline, because the book is not a clean per-chapter split of the two 1928 lectures it grew from.

## Sections

- `Essays/`: one file per essay, numbered so the folder lists in the book's order. Four are kept: the opening essay, one with footnotes (Modern Fiction), and the two with a `location:` and `map: true` so the places map has something to show.
- `Talks/`: a lecture (How Should One Read a Book?) and the first two chapters of *A Room of One's Own*, which is enough for one real previous and next pair. The other four chapters and Mr Bennett and Mrs Brown are cut: a clean two-chapter demonstration reads better than a partial six.
- `About.md`: a portrait, her own definition of the common reader, and a plain list of her books, the editions used, public-domain status and typefaces.
- The home page is her name and one sentence of hers. `home: true` and `children: false` keep it that way; without them the front page becomes a feed of every page.

Maps appear only on the essays that opt in with `map: true`, one per article. `[terms.places] line = false` in `.moss/config.toml` removes the automatic place line from every page, while `location:` still feeds the place beside the date on listing cards and the `/places/` page. `[site] header = "nav"` gives a plain row of links with no site name and no footer.

## Look

Fraunces for display and Literata for text, both SIL Open Font License 1.1, self-hosted in `.moss/theme/fonts/` with their licence files, as static instances of the variable fonts (about 87 KB for all four font files). One hue (150, sage) and one saturation, with light and dark inverting the same two lightness stops; body text is 13.13:1 against the page in both schemes, and the accent and muted colours each have their own light and dark stop so that both clear AA. Body size is a fluid `clamp()` from 19px to 21px; the measure stays fixed.

## What was cut

The full site this starter is cut from has 29 essays, all six chapters of *A Room of One's Own* and the full gazetteer. `.cut` lists the paths kept. `fixups.sh` removes two comments in the theme that point outside the starter.

## Licence

Both books are in the public domain in the United States (both published before 1931) and wherever the term is life plus 70 years or less (Woolf died in 1941, so the UK and EU since 2012). That is not "worldwide": countries with a longer term still protect them. The portrait is George Charles Beresford's 1902 photograph of Woolf; Beresford died in 1938, so the same framing applies. It is credited in its alt text on `About.md`, and About repeats the editions and the licence for readers of the site.

## Notes

A folder whose files are named `01-`, `02-`, … sorts correctly without anything else, but previous and next links need `series: true` on the folder's page, so `Talks/A Room of One's Own/` carries it. The talks' `source:` metadata never renders on the page, by design: it is provenance, like the dateline and the About list.
