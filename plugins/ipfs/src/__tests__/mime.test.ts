import { describe, it, expect } from "vitest";
import { mimeForPath } from "../mime";

describe("mimeForPath", () => {
  it.each([
    ["index.html", "text/html"],
    ["assets/app.css", "text/css"],
    ["assets/app.js", "text/javascript"],
    ["data.json", "application/json"],
    ["logo.svg", "image/svg+xml"],
    ["photo.JPG", "image/jpeg"],
    ["hero.webp", "image/webp"],
    ["font.woff2", "font/woff2"],
    ["clip.mp4", "video/mp4"],
    ["song.mp3", "audio/mpeg"],
    ["doc.pdf", "application/pdf"],
  ])("maps %s → %s", (path, expected) => {
    expect(mimeForPath(path)).toBe(expected);
  });

  it("defaults to application/octet-stream for unknown / extensionless paths", () => {
    expect(mimeForPath("bin/tool")).toBe("application/octet-stream");
    expect(mimeForPath("archive.xyz")).toBe("application/octet-stream");
    expect(mimeForPath("trailing.")).toBe("application/octet-stream");
  });
});
