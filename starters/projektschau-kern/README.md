# projektschau

Don Ludwig's [Projektschau for KERN](https://github.com/donludwig/projektschau-kern) as a moss site: a programme drawn as a board of cards, filterable by area and kind, with a timeline, in the look of the [KERN](https://www.kern-ux.de) UX standard. The picker shows it as **Projektschau**. The board, its data format and its design are Don Ludwig's; KERN is the KERN project's. What this starter adds is the folder layout that feeds the board and a fill to show it with.

## What fills it, and why

Fifteen projects of the City of Vienna's municipal programme, 1919–1934 (housing, health, welfare, sport, education), cut from The New Vienna, a reconstruction of the city's own overview *Das Neue Wien* (1926–28) from today's archives. It is a programme with many kinds of work over fifteen years, which is what Projektschau is for, and every fact on it carries a dated source. Don Ludwig's own demo of Projektschau is at [projektschau.thinkrepeat.com](https://projektschau.thinkrepeat.com/).

## What it shows

| Part | Pages kept | What it shows |
|---|---|---|
| Home | the board | `children_style: projektschau` over every project, three `highlights:`, the intro band as a `:::grid 2 3:2`. |
| Areas | Housing, Health, Welfare, Sport, Education & culture, three projects each | An area is a folder with `color:` and `icon:`; the board derives its tints from the colour. All four kinds are kept (Building, Service, Programme, Event) and the timeline still runs from 1917 to 1934. |
| Projects | Housing: Municipal housing programme, Housing construction tax, Karl-Marx-Hof. Health: Maternity advice centres, Children's open-air pools, School dental clinics. Welfare: all three. Sport: Second Workers' Olympiad, Prater Stadium, Kongressbad. Education & culture: Vienna school reform, Pedagogical Institute, Society and Economy Museum. | The declared fields `kind`, `years` and `figure`, `partners:`, captioned galleries, sources. The home's three highlights are among them; the Olympiad is the only Event; the school reform carries the full span. |
| Partners | the index and the ten people the kept projects name | A `partners` term with a page per name, four with portraits. |
| German | `de/`, the same pages | A language edition the board follows, its words from the plugin's German table. |
| About the sources | the page and the cover picture | The method and the picture holders, with counts recomputed for the cut. |

## The plugin, and which files are whose

The board runs as a plugin the site carries, in `site/.moss/plugins/projektschau/`, declared in `manifest.json`'s `plugins`. It is reviewed here as part of the starter.

- Don Ludwig's, unmodified from Projektschau for KERN 0.1.0: `projektschau.js` (the renderer), `projektschau.css` and `LICENSE.txt` (EUPL-1.2). Their bytes equal the files at tag `v0.1.0` upstream.
- The moss port: `main.js`, which turns the area folders and project pages into Projektschau's v1 data package and draws the board at build time by running the unchanged renderer, and `engine-shim.js`, the two browser objects the renderer needs inside moss's plugin engine. Both are EUPL-1.2 like the work they adapt. `manifest.json` names Don Ludwig as the author. The port's development test, `test.js`, stays in The New Vienna.
- `LICENSE-lucide.txt` covers the five area icons in `main.js`.

moss refuses a plugin that came with a folder until the user allows it, so the registry builds this starter with `--allow-plugins`, and a user's app asks them once to allow Projektschau when the site is first opened. Until then the home shows moss's own listing.

## Licence

- Words: CC0, written for The New Vienna from the sources each page lists.
- Pictures: Wien Museum (17, CC0), Wienbibliothek im Rathaus through Europeana (6, Public Domain Mark), the Austrian National Library through Wikimedia Commons (2, public domain: the photographer, Georg Fayer, died in 1950), and the Rijksmuseum through Wikimedia Commons (1, CC0). Each caption names its holder and record, and About the sources lists them.
- Code: Projektschau for KERN and the port, EUPL-1.2; the KERN kit's tokens and the part of it in `kern-board.css`, EUPL-1.2, licence in `.moss/theme/fonts/KERN-LICENSE.txt`.
- Font: Fira Sans from the KERN kit, SIL Open Font License 1.1, in `.moss/theme/fonts/OFL-FiraSans.txt`.
- Icons: Lucide, ISC.

EUPL-1.2 is a copyleft licence: whoever distributes the plugin or a changed copy of it must do so under the EUPL-1.2 (or a compatible licence it lists) and keep the licence with it, which `LICENSE.txt` in the plugin folder does.

## What was cut, and why

The New Vienna has 31 projects, 14 partners and 59 pictures. Its preview was 27.5 MB, against 1.3 to 7.6 MB for the other starters, so this keeps three projects per area and the partners they name, which is enough for every filter, every kind and the whole timeline. The cut leaves out Kanitz, Krist, Oerley and Stern with their projects, and in Sport keeps at most two pictures a page.

`fixups.sh` makes the corrections the cut cannot infer:

- the home loses its `title:` and gains `home: true`;
- the plugin manifest credits Don Ludwig, and the footers name him;
- the OFL and ISC notices go beside the fonts and the icons, because The New Vienna ships them without;
- a gallery picture the cut left out goes from its page with its caption, in both languages;
- About the sources gets its picture counts recomputed from what was kept;
- comments in the theme and in `main.js` lose the full site's design history, and `main.js` cites Projektschau at projektschau.thinkrepeat.com;
- the board's `in` lists and the highlights are checked against what was kept.

The licence texts it copies live in `licences/`.

The German home keeps its own `title:` (Das Neue Wien, 1919–1934): the contract's rule that the home inherits the folder name is about the site's root home page, and a language edition's home is not that page.
