/**
 * Fetch the plates a historical layer needs into its `source` folder.
 *
 * All I/O goes through an injected `Io`, so the loop is testable and `main.ts`
 * is the only file that touches moss-api.
 */

import {
  capWidth,
  parseAnnotation,
  planRegion,
  regionUrl,
  type Box,
  type InfoJson,
} from "./geo";

export interface Io {
  /** GET with the plugin's User-Agent. Throws on a transport error. */
  get(url: string): Promise<{ status: number; ok: boolean; text: string }>;
  /** Save a URL into a project folder under the given file name. */
  download(url: string, dir: string, filename: string): Promise<{ status: number; ok: boolean; bytes: number }>;
  /** File text, or null when the file is missing. */
  read(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  write(path: string, text: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** YYYY-MM-DD */
  today(): string;
  log(message: string): void;
}

export interface LayerSpec {
  name: string;
  source: string;
  annotations: string[];
  bbox?: Box;
  maxZoom: number;
}

export interface Tally {
  fetched: number;
  present: number;
  failed: number;
  skipped: number;
  refused: number;
  bytes: number;
}

/** A plate that must not be fetched; the message is shown to the site's author as is. */
class Refusal extends Error {}

const ATTEMPTS = 4;
const BASE_DELAY_MS = 1000;

/** The `[map.layers.<name>]` tables that name Allmaps annotations. */
export function parseLayers(raw: unknown): LayerSpec[] {
  if (!raw || typeof raw !== "object") return [];
  const layers: LayerSpec[] = [];
  for (const [name, t] of Object.entries(raw as Record<string, any>)) {
    if (t?.kind !== "historical" || typeof t.source !== "string") continue;
    const annotations = Array.isArray(t.annotations) ? t.annotations.filter((a: unknown) => typeof a === "string") : [];
    if (!annotations.length) continue;
    const b = t.bbox;
    const bbox = Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === "number") ? (b as Box) : undefined;
    layers.push({ name, source: t.source.replace(/\/+$/, ""), annotations, bbox, maxZoom: Number(t.max_zoom) || 16 });
  }
  return layers;
}

export const plateId = (annotationUrl: string): string => annotationUrl.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop() ?? "";

/** Retry on 429, 5xx and transport errors with doubling delays; any other non-2xx fails at once. */
async function withRetry<T extends { status: number; ok: boolean }>(io: Io, what: string, op: () => Promise<T>): Promise<T> {
  let last = "";
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt) await io.sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
    try {
      const r = await op();
      if (r.ok) return r;
      last = `HTTP ${r.status}`;
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`${what}: ${last}`);
}

async function isComplete(io: Io, source: string, id: string): Promise<boolean> {
  try {
    const ann = await io.read(`${source}/${id}.annotation.json`);
    const region = await io.read(`${source}/${id}.region.json`);
    if (ann === null || region === null) return false;
    JSON.parse(ann);
    const r = JSON.parse(region);
    return r?.version === 1 && typeof r.image === "string" && (await io.exists(`${source}/${r.image}`));
  } catch {
    return false;
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

async function fetchPlate(io: Io, layer: LayerSpec, annotationUrl: string, id: string): Promise<{ bytes: number } | "skipped"> {
  const annText = (await withRetry(io, "annotation", () => io.get(annotationUrl))).text;
  const annotation = parseAnnotation(JSON.parse(annText));

  let info: InfoJson;
  try {
    info = JSON.parse((await withRetry(io, "info.json", () => io.get(`${annotation.service}/info.json`))).text);
  } catch (e) {
    throw new Refusal(`the library's image service could not be read (${e instanceof Error ? e.message : e}), so the image cannot be checked against the annotation; nothing fetched`);
  }
  if (info.width !== annotation.width || info.height !== annotation.height) {
    const now = Number.isFinite(info.width) && Number.isFinite(info.height) ? `${info.width}×${info.height}` : "of unknown size";
    throw new Refusal(
      `the library's image is ${now} but the annotation was made on ${annotation.width}×${annotation.height}; the image has changed since it was georeferenced. Re-georeference it (for example in the Allmaps Editor) and update the annotation URL`,
    );
  }
  const planned = planRegion(annotation, layer.maxZoom, layer.bbox);
  if (!planned) return "skipped";
  const plan = capWidth(planned, info);

  const url = regionUrl(annotation.service, plan.region, plan.width);
  const image = await withRetry(io, "image", () => io.download(url, layer.source, `${id}.jpg`));
  if (!image.bytes) throw new Error("image: empty response");

  // The region file goes last: a folder without it is incomplete and is fetched again.
  await io.write(`${layer.source}/${id}.annotation.json`, annText);
  await io.write(
    `${layer.source}/${id}.region.json`,
    JSON.stringify(
      {
        version: 1,
        annotation: `${id}.annotation.json`,
        image: `${id}.jpg`,
        source: annotation.service,
        region: plan.region,
        scale: plan.scale,
        credit: annotation.provider ?? hostOf(annotation.service),
        rights: info.rights ?? info.license ?? "",
        fetched: io.today(),
      },
      null,
      2,
    ) + "\n",
  );
  io.log(`map-layers: plate ${id} region ${plan.region.join(",")} at scale ${plan.scale.toFixed(3)}, ${image.bytes} bytes`);
  return { bytes: image.bytes };
}

/** Fetch every plate of every layer, one request at a time. Failures are logged per plate and never thrown. */
export async function syncLayers(io: Io, layers: LayerSpec[]): Promise<Tally> {
  const tally: Tally = { fetched: 0, present: 0, failed: 0, skipped: 0, refused: 0, bytes: 0 };
  for (const layer of layers) {
    for (const annotationUrl of layer.annotations) {
      const id = plateId(annotationUrl);
      if (!id) {
        tally.failed++;
        io.log(`map-layers: layer "${layer.name}": "${annotationUrl}" is not an Allmaps annotation URL`);
        continue;
      }
      if (await isComplete(io, layer.source, id)) {
        tally.present++;
        continue;
      }
      try {
        const r = await fetchPlate(io, layer, annotationUrl, id);
        if (r === "skipped") {
          tally.skipped++;
          io.log(`map-layers: plate ${id} lies outside layer "${layer.name}"'s bbox; nothing fetched`);
        } else {
          tally.fetched++;
          tally.bytes += r.bytes;
        }
      } catch (e) {
        if (e instanceof Refusal) {
          tally.refused++;
          io.log(`map-layers: plate ${id}: ${e.message}`);
          continue;
        }
        tally.failed++;
        io.log(`map-layers: plate ${id} (layer "${layer.name}") failed, ${e instanceof Error ? e.message : e}; the build will have no image for it`);
      }
    }
  }
  return tally;
}

export function summary(t: Tally): string {
  const skipped = t.skipped ? `, ${t.skipped} outside the bbox` : "";
  const refused = t.refused ? `, ${t.refused} refused` : "";
  return `map-layers: ${t.fetched} plates fetched, ${t.present} already present, ${t.failed} failed${refused}${skipped}, ${t.bytes} bytes`;
}
