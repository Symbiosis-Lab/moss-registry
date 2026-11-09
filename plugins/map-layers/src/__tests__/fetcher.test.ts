import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupMockTauri, type MockTauriContext } from "@symbiosis-lab/moss-api/testing";
import { io as hostIo } from "../main";
import { parseLayers, plateId, summary, syncLayers, type Io, type LayerSpec } from "../fetcher";

const annotationText = readFileSync(new URL("./fixtures/95abed283977b2cc.annotation.json", import.meta.url), "utf8");
const SERVICE = "https://iiif.nypl.org/iiif/3/5222333";
const A1 = "https://annotations.allmaps.org/maps/95abed283977b2cc";
const A2 = "https://annotations.allmaps.org/maps/aaaaaaaaaaaaaaaa";
const SITE = "/site";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x80, 0x0a, 0xff, 0xd9]);
const b64 = (b: Uint8Array | string) => (typeof b === "string" ? btoa(b) : btoa(String.fromCharCode(...b)));

const layer: LayerSpec = {
  name: "atlas",
  source: "maps/atlas",
  annotations: [A1],
  bbox: [-74.0175, 40.702, -74.008, 40.71],
  maxZoom: 17,
};

type Reply = { status: number; ok?: boolean; bodyBase64?: string };
const reply = (status: number, bodyBase64 = ""): Reply => ({ status, ok: status >= 200 && status < 300, bodyBase64 });

const info = (over: object = {}) => ({ width: 8873, height: 6224, rights: "http://creativecommons.org/publicdomain/zero/1.0/", ...over });

let ctx: MockTauriContext;
let requests: string[];
let sleeps: number[];
let logs: string[];
let io: Io;

/** The mock answers the host commands moss-api invokes; only the clock and the log are replaced. */
beforeEach(() => {
  ctx = setupMockTauri({ projectPath: SITE, pluginName: "map-layers" });
  requests = [];
  sleeps = [];
  logs = [];
  const getResponse = ctx.urlConfig.getResponse.bind(ctx.urlConfig);
  ctx.urlConfig.getResponse = (url) => (requests.push(url), getResponse(url));
  ctx.urlConfig.setResponse(A1, reply(200, b64(annotationText)));
  ctx.urlConfig.setResponse(`${SERVICE}/info.json`, reply(200, b64(JSON.stringify(info()))));
  io = { ...hostIo, sleep: async (ms) => void sleeps.push(ms), today: () => "2026-01-02", log: (m) => void logs.push(m) };
});
afterEach(() => ctx.cleanup());

/** Every region request answers with `image`, a sequence or a single reply. */
function serveImages(image: Reply | Reply[]) {
  const orig = ctx.urlConfig.getResponse;
  ctx.urlConfig.getResponse = (url) => {
    if (url.endsWith("/0/default.jpg")) ctx.urlConfig.setResponse(url, image), (ctx.urlConfig.getResponse = orig);
    return orig(url);
  };
}
const imageRequests = () => requests.filter((u) => u.endsWith("/0/default.jpg"));
const file = (rel: string) => ctx.filesystem.getFile(`${SITE}/${rel}`);

describe("syncLayers", () => {
  it("writes the annotation, <id>.jpg with the exact bytes, and the region file", async () => {
    serveImages(reply(200, b64(JPEG)));
    const t = await syncLayers(io, [layer]);
    expect(t).toMatchObject({ fetched: 1, present: 0, failed: 0, bytes: JPEG.length });
    expect(file("maps/atlas/95abed283977b2cc.annotation.json")?.content).toBe(annotationText);
    expect(file("maps/atlas/95abed283977b2cc.jpg")?.bytes).toEqual(JPEG);
    const region = JSON.parse(file("maps/atlas/95abed283977b2cc.region.json")!.content);
    expect(region).toMatchObject({
      version: 1,
      annotation: "95abed283977b2cc.annotation.json",
      image: "95abed283977b2cc.jpg",
      source: SERVICE,
      credit: "New York Public Library",
      rights: "http://creativecommons.org/publicdomain/zero/1.0/",
      fetched: "2026-01-02",
    });
    expect(region.region).toHaveLength(4);
    const requested = Number(/\/(\d+),\/0\//.exec(imageRequests()[0])![1]);
    expect(Math.round(region.region[2] * region.scale)).toBe(requested);
  });
});

describe("skip when complete", () => {
  it("makes no request for a plate whose three files are present", async () => {
    serveImages(reply(200, b64(JPEG)));
    await syncLayers(io, [layer]);
    const before = requests.length;

    const again = await syncLayers(io, [layer]);
    expect(again).toMatchObject({ fetched: 0, present: 1, failed: 0 });
    expect(requests.length).toBe(before);
  });

  it("fetches again when the region file is missing or the image is gone", async () => {
    serveImages(reply(200, b64(JPEG)));
    await syncLayers(io, [layer]);
    ctx.filesystem.deleteFile(`${SITE}/maps/atlas/95abed283977b2cc.jpg`);
    expect(await syncLayers(io, [layer])).toMatchObject({ fetched: 1, present: 0 });
    ctx.filesystem.deleteFile(`${SITE}/maps/atlas/95abed283977b2cc.region.json`);
    expect(await syncLayers(io, [layer])).toMatchObject({ fetched: 1, present: 0 });
  });

  it("fetches again when the annotation file is unparseable", async () => {
    serveImages(reply(200, b64(JPEG)));
    await syncLayers(io, [layer]);
    ctx.filesystem.setFile(`${SITE}/maps/atlas/95abed283977b2cc.annotation.json`, "{ truncated");
    expect(await syncLayers(io, [layer])).toMatchObject({ fetched: 1, present: 0 });
  });
});

describe("politeness", () => {
  it("retries a 429 with doubling delays, then succeeds", async () => {
    serveImages([reply(429), reply(429), reply(200, b64(JPEG))]);
    const t = await syncLayers(io, [layer]);
    expect(t).toMatchObject({ fetched: 1, failed: 0 });
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("gives up on a persistent 503 after four attempts and names the plate", async () => {
    serveImages(reply(503));
    const t = await syncLayers(io, [layer]);
    expect(t).toMatchObject({ fetched: 0, failed: 1 });
    expect(imageRequests()).toHaveLength(4);
    expect(logs.join("\n")).toMatch(/plate 95abed283977b2cc .*failed.*HTTP 503/);
    expect(file("maps/atlas/95abed283977b2cc.region.json")).toBeUndefined();
  });

  it("does not retry a 404", async () => {
    serveImages(reply(404));
    await syncLayers(io, [layer]);
    expect(imageRequests()).toHaveLength(1);
  });
});

describe("failure isolation", () => {
  it("a failed plate leaves the others fetched and writes nothing for itself", async () => {
    ctx.urlConfig.setResponse(A2, reply(500));
    serveImages(reply(200, b64(JPEG)));
    const t = await syncLayers(io, [{ ...layer, annotations: [A2, A1] }]);
    expect(t).toMatchObject({ fetched: 1, failed: 1 });
    expect(file("maps/atlas/95abed283977b2cc.region.json")).toBeDefined();
    expect(ctx.filesystem.listFiles().some((k) => k.includes("aaaaaaaaaaaaaaaa"))).toBe(false);
    expect(summary(t)).toBe(`map-layers: 1 plates fetched, 0 already present, 1 failed, ${JPEG.length} bytes`);
  });
});

describe("image changed since georeferencing", () => {
  const infoUrl = `${SERVICE}/info.json`;

  it("refuses a plate whose image size differs from the annotation, fetches no image, and lets the others go on", async () => {
    ctx.urlConfig.setResponse(infoUrl, reply(200, b64(JSON.stringify(info({ width: 7778, height: 5288 })))));
    const t = await syncLayers(io, [layer]);
    expect(t).toMatchObject({ fetched: 0, failed: 0, refused: 1 });
    expect(imageRequests()).toHaveLength(0);
    expect(requests.filter((u) => u === infoUrl)).toHaveLength(1);
    expect(logs.join("\n")).toContain(
      "plate 95abed283977b2cc: the library's image is 7778×5288 but the annotation was made on 8873×6224; the image has changed since it was georeferenced. Re-georeference it (for example in the Allmaps Editor) and update the annotation URL",
    );
    expect(ctx.filesystem.listFiles().some((k) => k.includes("95abed283977b2cc"))).toBe(false);
    expect(summary(t)).toBe("map-layers: 0 plates fetched, 0 already present, 0 failed, 1 refused, 0 bytes");
  });

  it("refuses one plate and still fetches the next", async () => {
    ctx.urlConfig.setResponse(A2, reply(200, b64(annotationText.replace('"id": "https://iiif.nypl.org/iiif/3/5222333"', '"id": "https://iiif.example.org/iiif/9"'))));
    ctx.urlConfig.setResponse("https://iiif.example.org/iiif/9/info.json", reply(200, b64(JSON.stringify(info({ width: 1, height: 1 })))));
    serveImages(reply(200, b64(JPEG)));
    const t = await syncLayers(io, [{ ...layer, annotations: [A2, A1] }]);
    expect(t).toMatchObject({ fetched: 1, refused: 1, failed: 0 });
  });

  it("refuses when info.json cannot be read, rather than guessing", async () => {
    ctx.urlConfig.setResponse(infoUrl, reply(404));
    const t = await syncLayers(io, [layer]);
    expect(t).toMatchObject({ fetched: 0, failed: 0, refused: 1 });
    expect(imageRequests()).toHaveLength(0);
    expect(logs.join("\n")).toMatch(/plate 95abed283977b2cc: .*could not be read \(info\.json: HTTP 404\).*nothing fetched/);
  });
});

describe("parseLayers", () => {
  it("keeps historical layers that list annotations", () => {
    const layers = parseLayers({
      atlas: { kind: "historical", source: "maps/atlas/", annotations: [A1], bbox: [1, 2, 3, 4], max_zoom: 17 },
      streets: { kind: "streets", source: "x" },
      empty: { kind: "historical", source: "maps/none" },
    });
    expect(layers).toEqual([{ name: "atlas", source: "maps/atlas", annotations: [A1], bbox: [1, 2, 3, 4], maxZoom: 17 }]);
  });

  it("takes the plate id from the last URL segment", () => {
    expect(plateId(`${A1}/`)).toBe("95abed283977b2cc");
  });
});
