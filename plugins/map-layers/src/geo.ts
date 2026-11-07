/**
 * Pure geometry for the map-layers plugin: parse an Allmaps georeference
 * annotation, fit a first-order (affine) transform from its control points,
 * and plan the IIIF region to fetch. No moss-api imports.
 */

export type Pt = [number, number];
/** x' = a*x + b*y + c, y' = d*x + e*y + f */
export type Affine = [number, number, number, number, number, number];
/** [west, south, east, north] in degrees, or [minX, minY, maxX, maxY] in pixels */
export type Box = [number, number, number, number];

export interface Annotation {
  /** Allmaps map id (last segment of the annotation's own id, when present). */
  service: string;
  width: number;
  height: number;
  /** SvgSelector polygon in full-image pixels. */
  polygon: Pt[];
  /** Control points: full-image pixel and [lng, lat]. */
  gcps: { px: Pt; geo: Pt }[];
  /** provider label of the image source, when the annotation carries one. */
  provider?: string;
}

export interface InfoJson {
  width?: number;
  height?: number;
  rights?: string;
  license?: string;
  maxWidth?: number;
  maxArea?: number;
}

export interface Plan {
  /** [x, y, w, h] in full-image pixels */
  region: [number, number, number, number];
  /** fetched pixels per full-image pixel; image width = w * scale */
  scale: number;
  /** pixel width to request */
  width: number;
}

function solve3(m: number[][], v: number[]): number[] {
  const a = m.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) throw new Error("control points are collinear");
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = a[r][c] / a[c][c];
      for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

/** Least-squares affine fit src -> dst, on coordinates centred and scaled for conditioning. */
export function fitAffine(src: Pt[], dst: Pt[]): Affine {
  if (src.length < 3 || src.length !== dst.length) {
    throw new Error("need at least 3 control points");
  }
  const n = src.length;
  const stat = (pts: Pt[]) => {
    const mx = pts.reduce((s, p) => s + p[0], 0) / n;
    const my = pts.reduce((s, p) => s + p[1], 0) / n;
    const sd = Math.sqrt(pts.reduce((s, p) => s + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / (2 * n)) || 1;
    return { mx, my, sd };
  };
  const S = stat(src);
  const D = stat(dst);
  const rows = src.map((p) => [(p[0] - S.mx) / S.sd, (p[1] - S.my) / S.sd, 1]);
  const ata = [0, 1, 2].map((i) => [0, 1, 2].map((j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const solveFor = (k: 0 | 1) => {
    const atb = [0, 1, 2].map((i) => rows.reduce((s, r, idx) => s + r[i] * (dst[idx][k] - (k ? D.my : D.mx)) / D.sd, 0));
    return solve3(ata, atb);
  };
  const [a, b, c] = solveFor(0);
  const [d, e, f] = solveFor(1);
  // Undo the normalisation: x' = mx' + sd'*(a*(x-mx)/sd + b*(y-my)/sd + c)
  const k = D.sd / S.sd;
  return [
    a * k,
    b * k,
    D.mx + D.sd * c - a * k * S.mx - b * k * S.my,
    d * k,
    e * k,
    D.my + D.sd * f - d * k * S.mx - e * k * S.my,
  ];
}

export function applyAffine(t: Affine, p: Pt): Pt {
  return [t[0] * p[0] + t[1] * p[1] + t[2], t[3] * p[0] + t[4] * p[1] + t[5]];
}

export function invertAffine(t: Affine): Affine {
  const det = t[0] * t[4] - t[1] * t[3];
  if (Math.abs(det) < 1e-30) throw new Error("transform is singular");
  const a = t[4] / det;
  const b = -t[1] / det;
  const d = -t[3] / det;
  const e = t[0] / det;
  return [a, b, -(a * t[2] + b * t[5]), d, e, -(d * t[2] + e * t[5])];
}

function bounds(pts: Pt[]): Box {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function intersect(a: Box, b: Box): Box | null {
  const r: Box = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return r[0] < r[2] && r[1] < r[3] ? r : null;
}

const asNum = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("annotation has a non-numeric coordinate");
  return v;
};

function firstLabel(label: unknown): string | undefined {
  if (!label || typeof label !== "object") return undefined;
  for (const v of Object.values(label as Record<string, unknown>)) {
    if (Array.isArray(v) && typeof v[0] === "string" && v[0]) return v[0];
  }
  return undefined;
}

/** Read the fields the plugin needs from an Allmaps georeference annotation (a single one, or an AnnotationPage's first). */
export function parseAnnotation(json: any): Annotation {
  const ann = json?.type === "AnnotationPage" ? json.items?.[0] : json;
  const source = ann?.target?.source;
  if (!source?.id) throw new Error("annotation has no target.source.id");
  const svg: string = ann.target?.selector?.value ?? "";
  const points = /points=["']([^"']+)["']/.exec(svg)?.[1];
  if (!points) throw new Error("annotation has no SvgSelector polygon");
  const polygon = points.trim().split(/\s+/).map((s): Pt => {
    const [x, y] = s.split(",").map(Number);
    return [asNum(x), asNum(y)];
  });
  const features: any[] = ann.body?.features ?? [];
  const gcps = features.map((f) => ({
    px: [asNum(f.properties?.resourceCoords?.[0]), asNum(f.properties?.resourceCoords?.[1])] as Pt,
    geo: [asNum(f.geometry?.coordinates?.[0]), asNum(f.geometry?.coordinates?.[1])] as Pt,
  }));
  if (gcps.length < 3) throw new Error("annotation has fewer than 3 control points");
  return {
    service: String(source.id).replace(/\/+$/, ""),
    width: asNum(source.width),
    height: asNum(source.height),
    polygon,
    gcps,
    provider: firstLabel(source.provider?.[0]?.label),
  };
}

/** Degrees of longitude per screen pixel at a web-map zoom level. */
export const degreesPerPixel = (zoom: number): number => 360 / (256 * 2 ** zoom);

/** Fetched pixels per screen pixel: 2 keeps a plate sharp on a high-density screen. */
export const DENSITY = 2;

/**
 * Choose the full-image rectangle to fetch and the scale to fetch it at.
 * `bbox` (west, south, east, north) widened by 5% on each side bounds the
 * region; without it the whole plate is fetched.
 */
export function planRegion(a: Annotation, maxZoom: number, bbox?: Box): Plan | null {
  const fwd = fitAffine(a.gcps.map((g) => g.px), a.gcps.map((g) => g.geo));
  const inv = invertAffine(fwd);
  const polyPx = bounds(a.polygon);
  let wanted: Box = bounds(a.polygon.map((p) => applyAffine(fwd, p)));
  if (bbox) {
    const mx = (bbox[2] - bbox[0]) * 0.05;
    const my = (bbox[3] - bbox[1]) * 0.05;
    const hit = intersect(wanted, [bbox[0] - mx, bbox[1] - my, bbox[2] + mx, bbox[3] + my]);
    if (!hit) return null;
    wanted = hit;
  }
  // The transform may rotate, so map all four corners back.
  const corners = bounds(
    ([[wanted[0], wanted[1]], [wanted[2], wanted[1]], [wanted[2], wanted[3]], [wanted[0], wanted[3]]] as Pt[]).map((p) => applyAffine(inv, p)),
  );
  const px = intersect(intersect(corners, polyPx) ?? [0, 0, 0, 0], [0, 0, a.width, a.height]);
  if (!px) return null;
  const x = Math.floor(px[0]);
  const y = Math.floor(px[1]);
  const w = Math.min(a.width, Math.ceil(px[2])) - x;
  const h = Math.min(a.height, Math.ceil(px[3])) - y;
  if (w < 1 || h < 1) return null;

  const degPerFullPx = Math.hypot(fwd[0], fwd[1]);
  const scale = Math.min(1, DENSITY * degPerFullPx / degreesPerPixel(maxZoom));
  const width = Math.max(1, Math.round(w * scale));
  return { region: [x, y, w, h], scale: width / w, width };
}

/** Lower the requested width to what the image service allows (`maxWidth`, `maxArea`). */
export function capWidth(plan: Plan, info: InfoJson): Plan {
  const [, , w, h] = plan.region;
  let width = plan.width;
  if (info.maxWidth) width = Math.min(width, info.maxWidth);
  if (info.maxArea) width = Math.min(width, Math.floor(Math.sqrt((info.maxArea * w) / h)));
  width = Math.max(1, width);
  return width === plan.width ? plan : { ...plan, width, scale: width / w };
}

/** IIIF Image API region request. Image API 2 services accept the same syntax. */
export function regionUrl(service: string, region: Plan["region"], width: number): string {
  return `${service.replace(/\/+$/, "")}/${region.join(",")}/${width},/0/default.jpg`;
}
