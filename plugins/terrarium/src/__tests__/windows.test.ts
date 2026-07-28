import { describe, it, expect } from "vitest";
import {
  WINDOWS,
  type Window,
  type PluginPayload,
  type SimPayload,
} from "../windows";

// The enum value sets, mirrored from the moss contract (bindings.ts):
//   Scope     = File | Config | Environment | Remote | Account
//   Severity  = ShippedDegraded | NeedsAction | Blocking
//   TaskScope = action_panel | preview | workspace
//   TaskTone  = ambient | inline | narrated | awaiting
const SCOPES = ["File", "Config", "Environment", "Remote", "Account"];
const SEVERITIES = ["ShippedDegraded", "NeedsAction", "Blocking"];
const TASK_SCOPES = ["action_panel", "preview", "workspace"];
const TASK_TONES = ["ambient", "inline", "narrated", "awaiting"];
const GROUPS = ["Deploy", "Domain", "Plugin", "Build", "Modal"];

// An Action is "None" | {Command} | {InApp} | {Link}.
function isWellFormedAction(action: unknown): boolean {
  if (action === "None") return true;
  if (typeof action !== "object" || action === null) return false;
  const a = action as Record<string, unknown>;
  if ("Command" in a) {
    const c = a.Command as Record<string, unknown>;
    return typeof c?.run === "string" && typeof c?.label === "string";
  }
  if ("InApp" in a) {
    const c = a.InApp as Record<string, unknown>;
    return (
      typeof c?.op === "string" &&
      "args" in c &&
      typeof c?.label === "string"
    );
  }
  if ("Link" in a) {
    const c = a.Link as Record<string, unknown>;
    return typeof c?.href === "string" && typeof c?.label === "string";
  }
  return false;
}

function isWellFormedAdvisory(adv: unknown): boolean {
  if (typeof adv !== "object" || adv === null) return false;
  const a = adv as Record<string, unknown>;
  return (
    SCOPES.includes(a.scope as string) &&
    SEVERITIES.includes(a.severity as string) &&
    (a.item === null || typeof a.item === "string") &&
    typeof a.what === "string" &&
    isWellFormedAction(a.action)
  );
}

describe("WINDOWS catalog", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(WINDOWS)).toBe(true);
    expect(WINDOWS.length).toBeGreaterThan(0);
  });

  it("has unique ids", () => {
    const ids = WINDOWS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains the 9 spec ids", () => {
    const expected = [
      "deploy-success",
      "deploy-fail",
      "domain-awaiting",
      "domain-configuring",
      "syndicate-ok",
      "gap2",
      "gavel",
      "ffmpeg-degraded",
      "workspace-fail",
    ];
    const ids = WINDOWS.map((w) => w.id);
    for (const id of expected) {
      expect(ids, `missing window id '${id}'`).toContain(id);
    }
  });

  it("every entry has a group, a known driver, a label and a surface", () => {
    for (const w of WINDOWS) {
      expect(GROUPS, `bad group on '${w.id}'`).toContain(w.group);
      expect(["plugin", "sim", "modal"], `bad driver on '${w.id}'`).toContain(w.driver);
      expect(typeof w.label, `bad label on '${w.id}'`).toBe("string");
      expect(w.label.length).toBeGreaterThan(0);
      expect(typeof w.surface, `bad surface on '${w.id}'`).toBe("string");
      expect(w.surface.length).toBeGreaterThan(0);
    }
  });

  it("sim payloads are well-formed DevSimulateArgs", () => {
    const sims = WINDOWS.filter((w): w is Window & { payload: SimPayload } =>
      w.driver === "sim",
    );
    expect(sims.length).toBeGreaterThan(0);
    for (const w of sims) {
      const p = w.payload;
      expect(typeof p.window_id, `window_id on '${w.id}'`).toBe("string");
      expect(TASK_SCOPES, `scope on '${w.id}'`).toContain(p.scope);
      expect(TASK_TONES, `tone on '${w.id}'`).toContain(p.tone);
      expect(typeof p.kind, `kind on '${w.id}'`).toBe("string");
      expect(p.kind.length).toBeGreaterThan(0);
      expect(Array.isArray(p.steps), `steps on '${w.id}'`).toBe(true);
      expect(p.steps.length).toBeGreaterThan(0);
      for (const step of p.steps) {
        expect(
          ["progress", "awaiting", "succeeded", "failed", "cancelled"],
          `step kind on '${w.id}'`,
        ).toContain(step.kind);
        if (step.kind === "succeeded") {
          for (const adv of step.advisories ?? []) {
            expect(isWellFormedAdvisory(adv), `succeeded advisory on '${w.id}'`).toBe(
              true,
            );
          }
        }
        if (step.kind === "failed" && step.advisory != null) {
          expect(isWellFormedAdvisory(step.advisory), `failed advisory on '${w.id}'`).toBe(
            true,
          );
        }
      }
    }
  });

  it("plugin payloads are well-formed lifecycle drivers", () => {
    const plugins = WINDOWS.filter(
      (w): w is Window & { payload: PluginPayload } => w.driver === "plugin",
    );
    expect(plugins.length).toBeGreaterThan(0);
    for (const w of plugins) {
      const p = w.payload;
      expect(typeof p.hook, `hook on '${w.id}'`).toBe("string");
      expect(typeof p.trigger, `trigger on '${w.id}'`).toBe("string");
      expect(typeof p.label, `label on '${w.id}'`).toBe("string");
      expect(
        ["succeeded", "failed", "awaiting"],
        `terminal kind on '${w.id}'`,
      ).toContain(p.terminal.kind);
      if (p.terminal.kind === "succeeded") {
        for (const adv of p.terminal.advisories ?? []) {
          expect(isWellFormedAdvisory(adv), `succeeded advisory on '${w.id}'`).toBe(true);
        }
      }
      if (p.terminal.kind === "failed") {
        expect(typeof p.terminal.error, `error on '${w.id}'`).toBe("string");
        expect(typeof p.terminal.recoverable, `recoverable on '${w.id}'`).toBe("boolean");
        for (const adv of p.terminal.advisories ?? []) {
          expect(isWellFormedAdvisory(adv), `failed advisory on '${w.id}'`).toBe(true);
        }
      }
      if (p.terminal.kind === "awaiting") {
        expect(typeof p.terminal.directive, `directive on '${w.id}'`).toBe("string");
        expect(typeof p.terminal.escape, `escape on '${w.id}'`).toBe("string");
      }
    }
  });

  it("the spec id->driver mapping is honoured", () => {
    const byId = new Map(WINDOWS.map((w) => [w.id, w]));
    const expectSim = ["deploy-success", "deploy-fail", "domain-awaiting", "domain-configuring", "ffmpeg-degraded"];
    const expectPlugin = ["syndicate-ok", "gap2", "gavel", "workspace-fail"];
    for (const id of expectSim) expect(byId.get(id)?.driver, id).toBe("sim");
    for (const id of expectPlugin) expect(byId.get(id)?.driver, id).toBe("plugin");
    // ffmpeg-degraded is a build-kind sim with a ShippedDegraded advisory.
    const ffmpeg = byId.get("ffmpeg-degraded");
    expect(ffmpeg?.driver).toBe("sim");
    expect((ffmpeg?.payload as SimPayload).kind).toBe("build");
  });
});
