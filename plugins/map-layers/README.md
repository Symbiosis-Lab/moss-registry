# @symbiosis-lab/moss-plugin-map-layers

> Fetch the georeferenced map scans a site's historical map layer needs into the site's own folder, so the site works offline afterwards.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![status](https://img.shields.io/badge/status-experimental-orange)](../README.md#stability)

A moss `process` plugin. A historical map layer draws old maps that libraries have scanned and that volunteers have georeferenced with [Allmaps](https://allmaps.org). This plugin downloads those scans once, in the part and at the detail the layer needs, and leaves them in a folder of the site. The build reads only that folder, so the site no longer depends on the library's server.

## Configuration

Each layer names the Allmaps annotations it is made of:

```toml
[map.layers.atlas]
kind = "historical"
source = "maps/atlas"
bbox = [-74.0175, 40.7020, -74.0080, 40.7100]
max_zoom = 17
annotations = ["https://annotations.allmaps.org/maps/95abed283977b2cc"]
```

`kind`, `source`, `bbox` and `max_zoom` are the layer's own settings, which the plugin reads too. The build uses `annotations` for the order the plates are drawn in.

## What it does

For every annotation that is not yet complete in `source`:

1. Fetches the annotation and the image service's `info.json` (one request, which also supplies the rights statement and the service's size limits).
2. Checks that the library's image is still the one that was georeferenced: the `width` and `height` in `info.json` must equal the annotation's `target.source` width and height. Libraries sometimes re-cut an image after it was georeferenced; a region cut from the new image would land in the wrong place on the map. On a mismatch, or when `info.json` cannot be read, nothing is fetched for that plate. The log says plainly what differs, for example `plate <id>: the library's image is 7778×5288 but the annotation was made on 8079×6542; the image has changed since it was georeferenced. Re-georeference it (for example in the Allmaps Editor) and update the annotation URL`. The other plates go on.
3. Fits an affine transform from the annotation's control points, maps the scan's outline to longitude and latitude, intersects it with the layer's `bbox` widened by 5% (the whole scan when there is no `bbox`), and maps the result back to a pixel rectangle.
4. Chooses a scale so one fetched pixel is about the ground size of half a screen pixel at `max_zoom` (twice the screen density, so plates stay sharp on high-density screens), never above 1, which is the plate's full resolution, and requests that rectangle with the IIIF Image API: `<service>/<x>,<y>,<w>,<h>/<width>,/0/default.jpg`. Image API 2 and 3 services take the same request.
5. Writes three things into `source`: `<id>.annotation.json` (the annotation as fetched), `<id>.jpg` (the image region) and `<id>.region.json`.

`<id>.region.json` records what was fetched. It is written last, so a folder without it is retried on the next run:

```json
{
  "version": 1,
  "annotation": "<id>.annotation.json",
  "image": "<id>.jpg",
  "source": "<IIIF image service id>",
  "region": [x, y, w, h],
  "scale": 0.1,
  "credit": "Provider named by the annotation, else the image host",
  "rights": "The service's rights statement, may be empty",
  "fetched": "YYYY-MM-DD"
}
```

A scan counts as present when its annotation and region file parse and the image file exists. Present scans cost no network request. To fetch a scan again, for a new `bbox` or a higher `max_zoom`, delete its `<id>.region.json`.

The plugin is polite to the servers it uses: one request at a time, a User-Agent that names moss, and up to four attempts with doubling delays on `429` and `5xx`. A scan that cannot be fetched is named in the log and left out. The build goes on without it, and the build notes the missing image. The run ends with a line like `map-layers: 2 plates fetched, 1 already present, 0 failed, 1843210 bytes`; refused plates are counted separately (`1 refused`).

## What moss provides

The layer tables live in the site's `.moss/config.toml`, which plugins cannot read. The plugin reads them from `site_config.map.layers` in the process context, and has no other source for them: a moss version that does not supply `site_config` leaves the plugin with nothing to fetch. Images are written with `write_project_file_binary` and `download_asset` under the plugin's file name.

## Network access

- `https://annotations.allmaps.org/maps/<id>`: the georeference annotation.
- `<image service>/info.json` and `<image service>/<region>/<size>/0/default.jpg`: the IIIF image service named by the annotation, for example `iiif.nypl.org`.

Nothing else is contacted, and nothing is sent beyond the request URLs and the User-Agent.

## Development

```bash
pnpm install
pnpm --filter @symbiosis-lab/moss-plugin-map-layers run test
pnpm --filter @symbiosis-lab/moss-plugin-map-layers run build
```

The geometry (`src/geo.ts`) and the fetch loop (`src/fetcher.ts`) have no moss-api imports; `src/main.ts` binds them to the host.

## Stability

This plugin is 0.x. APIs may change between minor versions until 1.0.

## License

MIT, see [LICENSE](../LICENSE).
