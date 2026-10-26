# PDF OCR

Shows a folder's PDFs as pages. moss writes a page for each PDF in a folder you choose, and this plugin fills it with the document's text, reading scanned pages by OCR, plus a title, a date when the first page carries one, and a line such as "6 pages, scanned".

Choose the folders in `.moss/config.toml`:

```toml
[derive]
"reports/" = ["pdf-pages"]
```

A PDF added to a chosen folder gets its page at once; the text follows when the reading finishes, and a site cannot be published while a reading is still running. A page you delete stays deleted.

Runs on macOS on Apple silicon. moss downloads the program the first time a site needs it (about 12 MB: pdf-ocr, pdfium and Tesseract with English language data) and checks it against the sha256 in the manifest; nothing else needs installing.

## Network access

None. The program runs with the network denied (moss confines it on macOS), reads the PDF it is given and writes only to its scratch and cache folders. moss itself downloads the program once from this registry's release.

## Source

The program's source is in [`native/`](native/): Rust, with pdfium and Tesseract. [`native/README.md`](native/README.md) describes its protocol, its text rules and how it is built.
