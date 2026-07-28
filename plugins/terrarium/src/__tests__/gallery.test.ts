import { describe, it, expect } from "vitest";
import { renderGallery } from "../gallery";
import { WINDOWS } from "../windows";

describe("renderGallery", () => {
  const html = renderGallery(WINDOWS);

  it("returns a non-empty HTML document string", () => {
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("emits one data-window-id per window", () => {
    for (const w of WINDOWS) {
      expect(html, `missing row for '${w.id}'`).toContain(`data-window-id="${w.id}"`);
    }
    const count = (html.match(/data-window-id="/g) ?? []).length;
    expect(count).toBe(WINDOWS.length);
  });

  it("renders a heading for each group present", () => {
    const groups = [...new Set(WINDOWS.map((w) => w.group))];
    for (const g of groups) {
      expect(html, `missing group heading '${g}'`).toContain(g);
    }
  });

  it("shows each window's label", () => {
    for (const w of WINDOWS) {
      // Labels can contain characters that get HTML-escaped; check a safe prefix.
      const probe = w.label.split(/[<>&"]/)[0];
      expect(html, `missing label for '${w.id}'`).toContain(probe);
    }
  });

  it("embeds a <script> that drives the Tauri command bridge", () => {
    expect(html).toContain("<script>");
    expect(html).toContain("</script>");
    expect(html).toContain("window.__TAURI__");
    // both driver commands are referenced by the embedded driver
    expect(html).toContain("dev_simulate_panel_task");
    expect(html).toContain("report_plugin_task_lifecycle_command");
  });

  it("uses the verified Tauri v2 camelCase invoke arg keys", () => {
    expect(html).toContain("pluginName");
    expect(html).toContain("taskId");
  });

  it("wraps invokes in try/catch and logs errors (degrades to a no-op)", () => {
    expect(html).toContain("try");
    expect(html).toContain("catch");
    expect(html).toContain("console.error");
  });

  it("serialises the catalog into the embedded script", () => {
    // The driver looks windows up from an embedded JSON copy of the catalog.
    for (const w of WINDOWS) {
      expect(html, `catalog id '${w.id}' not embedded`).toContain(`"${w.id}"`);
    }
  });

  it("never leaks a literal 'undefined'", () => {
    expect(html).not.toContain("undefined");
  });
});
