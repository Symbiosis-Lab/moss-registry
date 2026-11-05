# PDF OCR

Shows a folder's PDFs as pages. moss writes a page for each PDF in a folder you choose, and this plugin fills it with the document's text, reading scanned pages by OCR, plus a title, a date when the first page carries one, and a line such as "6 pages, scanned".

Choose the folders in `.moss/config.toml`:

```toml
[derive]
"reports/" = ["pdf-pages"]
```

A PDF added to a chosen folder gets its page at once; the text follows when the reading finishes, and a site cannot be published while a reading is still running. A page you delete stays deleted.

PDF OCR is a preview plugin: the moss app's plugin catalog lists it once **Preview features** is on in the app's settings. A site that already has it keeps running it with the setting off.

Runs on macOS on Apple silicon and on 64-bit Linux, x86 or ARM, with glibc 2.35 or newer (Ubuntu 22.04, Debian 12 and later). moss downloads the program the first time a site needs it (about 12 MB: pdf-ocr, pdfium and Tesseract with English language data) and checks it against the sha256 in the manifest; nothing else needs installing.

## Network access

None. The program reads the PDF it is given and writes only to its scratch and cache folders. On macOS moss runs it with the network denied; on Linux moss does not confine it yet, and the sha256 pinned in the manifest is what guarantees it is the program built here. moss itself downloads the program once from this registry's release.

## Source

The program's source is in [`native/`](native/): Rust, with pdfium and Tesseract. [`native/README.md`](native/README.md) describes its protocol, its text rules and how it is built.
