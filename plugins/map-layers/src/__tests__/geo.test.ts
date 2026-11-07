import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyAffine,
  capWidth,
  degreesPerPixel,
  fitAffine,
  invertAffine,
  parseAnnotation,
  planRegion,
  regionUrl,
  type Box,
} from "../geo";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/95abed283977b2cc.annotation.json", import.meta.url), "utf8"));
const annotation = parseAnnotation(fixture);
const BBOX: Box = [-74.015, 40.706, -74.012, 40.708];

describe("fitAffine", () => {
  it("recovers an exact affine map, rotation included", () => {
    const t = [2e-5, 3e-6, -74.2, -4e-6, -2.1e-5, 40.9] as const;
    const src: [number, number][] = [[0, 0], [8000, 100], [300, 6000], [7000, 5000], [4000, 3000]];
    const dst = src.map((p) => applyAffine([...t], p));
    const fit = fitAffine(src, dst);
    fit.forEach((v, i) => expect(v).toBeCloseTo(t[i], 12));
  });

  it("fits the plate's 30 control points to within a few metres", () => {
    expect(annotation.gcps).toHaveLength(30);
    const fit = fitAffine(annotation.gcps.map((g) => g.px), annotation.gcps.map((g) => g.geo));
    const sq = annotation.gcps.map((g) => {
      const [lng, lat] = applyAffine(fit, g.px);
      const dx = (lng - g.geo[0]) * 111320 * Math.cos((g.geo[1] * Math.PI) / 180);
      const dy = (lat - g.geo[1]) * 110540;
      return dx * dx + dy * dy;
    });
    const rms = Math.sqrt(sq.reduce((s, v) => s + v, 0) / sq.length);
    expect(rms).toBeLessThan(30);
  });

  it("inverts", () => {
    const fit = fitAffine(annotation.gcps.map((g) => g.px), annotation.gcps.map((g) => g.geo));
    const back = applyAffine(invertAffine(fit), applyAffine(fit, [1234, 5678]));
    expect(back[0]).toBeCloseTo(1234, 6);
    expect(back[1]).toBeCloseTo(5678, 6);
  });

  it("refuses collinear points", () => {
    expect(() => fitAffine([[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 1], [2, 2]])).toThrow(/collinear/);
  });
});

describe("parseAnnotation", () => {
  it("reads the image service, size, polygon and provider", () => {
    expect(annotation.service).toBe("https://iiif.nypl.org/iiif/3/5222333");
    expect([annotation.width, annotation.height]).toEqual([8873, 6224]);
    expect(annotation.polygon.length).toBeGreaterThan(10);
    expect(annotation.provider).toBe("New York Public Library");
  });
});

describe("planRegion", () => {
  it("fetches only the part of the plate the bbox needs, plus a 5% margin", () => {
    const whole = planRegion(annotation, 17)!;
    const part = planRegion(annotation, 17, BBOX)!;
    const [x, y, w, h] = part.region;
    expect(w * h).toBeLessThan(whole.region[2] * whole.region[3] * 0.5);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(annotation.width);
    expect(y + h).toBeLessThanOrEqual(annotation.height);

    // the region, mapped to the ground, covers the bbox and stays within bbox + margin + the plate's slant
    const fit = fitAffine(annotation.gcps.map((g) => g.px), annotation.gcps.map((g) => g.geo));
    const lngs = [x, x + w].flatMap((px) => [y, y + h].map((py) => applyAffine(fit, [px, py])[0]));
    const lats = [x, x + w].flatMap((px) => [y, y + h].map((py) => applyAffine(fit, [px, py])[1]));
    expect(Math.min(...lngs)).toBeLessThanOrEqual(BBOX[0]);
    expect(Math.max(...lngs)).toBeGreaterThanOrEqual(BBOX[2]);
    expect(Math.min(...lats)).toBeLessThanOrEqual(BBOX[1]);
    expect(Math.max(...lats)).toBeGreaterThanOrEqual(BBOX[3]);
  });

  it("picks the scale at which one fetched pixel is half a screen pixel at max_zoom", () => {
    const plan = planRegion(annotation, 17, BBOX)!;
    const fit = fitAffine(annotation.gcps.map((g) => g.px), annotation.gcps.map((g) => g.geo));
    const degPerFetched = Math.hypot(fit[0], fit[1]) / plan.scale;
    expect(degPerFetched / degreesPerPixel(17)).toBeCloseTo(0.5, 2);
    expect(plan.scale).toBeLessThanOrEqual(1);
    expect(plan.width).toBe(Math.round(plan.region[2] * plan.scale));
  });

  it("never upscales", () => {
    expect(planRegion(annotation, 22, BBOX)!.scale).toBe(1);
  });

  it("returns null for a bbox the plate does not reach", () => {
    expect(planRegion(annotation, 17, [2.29, 48.85, 2.3, 48.86])).toBeNull();
  });
});

describe("capWidth", () => {
  it("respects the service's maxWidth and keeps scale consistent", () => {
    const plan = { region: [0, 0, 4000, 3000] as [number, number, number, number], scale: 0.5, width: 2000 };
    const capped = capWidth(plan, { maxWidth: 1000 });
    expect(capped.width).toBe(1000);
    expect(capped.scale).toBe(0.25);
  });
});

describe("regionUrl", () => {
  it("is an IIIF Image API region request", () => {
    expect(regionUrl("https://iiif.example.org/iiif/3/42/", [10, 20, 300, 400], 150)).toBe(
      "https://iiif.example.org/iiif/3/42/10,20,300,400/150,/0/default.jpg",
    );
  });
});
