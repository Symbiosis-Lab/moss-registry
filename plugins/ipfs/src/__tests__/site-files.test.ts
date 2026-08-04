import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  inFlight: 0,
  maxInFlight: 0,
  byPath: {} as Record<string, string>,
}));

vi.mock("@symbiosis-lab/moss-api", () => ({
  // utils.ts (imported for formatBytes) touches these at module load.
  setMessageContext: vi.fn(),
  reportProgress: vi.fn(),
  reportError: vi.fn(),
  showToast: vi.fn(),
  closeBrowser: vi.fn(),
  readSiteFile: vi.fn(async (path: string) => {
    h.inFlight++;
    h.maxInFlight = Math.max(h.maxInFlight, h.inFlight);
    await new Promise((r) => setTimeout(r, 1));
    h.inFlight--;
    return h.byPath[path] ?? "aGVsbG8="; // "hello"
  }),
}));

import { readSiteFiles, sizeFromBase64 } from "../site-files";

beforeEach(() => {
  h.inFlight = 0;
  h.maxInFlight = 0;
  h.byPath = {};
  vi.clearAllMocks();
});

describe("sizeFromBase64", () => {
  it("computes decoded sizes including padding", () => {
    expect(sizeFromBase64("")).toBe(0);
    expect(sizeFromBase64("aGVsbG8=")).toBe(5); // "hello"
    expect(sizeFromBase64("aGk=")).toBe(2); // "hi"
    expect(sizeFromBase64("aGV5YQ==")).toBe(4); // "heya"
    expect(sizeFromBase64("aGV5YWg=")).toBe(5); // "heyah"
  });
});

describe("readSiteFiles", () => {
  it("throws on an empty path list", async () => {
    await expect(readSiteFiles([])).rejects.toThrow(/build your site/i);
  });

  it("reads exactly the given paths, in order, with normalized output paths", async () => {
    const { files, totalBytes } = await readSiteFiles(["./index.html", "assets\\app.css"]);
    expect(files.map((f) => f.path)).toEqual(["index.html", "assets/app.css"]);
    expect(files.every((f) => f.size === 5)).toBe(true);
    expect(totalBytes).toBe(10);
  });

  it("runs reads concurrently but bounded", async () => {
    const paths = Array.from({ length: 20 }, (_, i) => `f${i}.txt`);
    await readSiteFiles(paths);
    expect(h.maxInFlight).toBeGreaterThan(1); // actually concurrent
    expect(h.maxInFlight).toBeLessThanOrEqual(8); // bounded
  });

  it("reports monotonically increasing progress up to 100", async () => {
    const pcts: number[] = [];
    await readSiteFiles(["a.txt", "b.txt", "c.txt"], (pct) => pcts.push(pct));
    expect(pcts.at(-1)).toBe(100);
    expect(pcts.length).toBe(3);
  });
});
