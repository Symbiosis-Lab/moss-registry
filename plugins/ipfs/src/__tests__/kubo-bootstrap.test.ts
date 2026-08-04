import { describe, it, expect, vi } from "vitest";

vi.mock("@symbiosis-lab/moss-api", () => ({
  setMessageContext: vi.fn(),
  reportProgress: vi.fn(),
  reportError: vi.fn(),
  showToast: vi.fn(),
  dismissToast: vi.fn(),
  closeBrowser: vi.fn(),
  executeBinary: vi.fn(),
  getPlatformInfo: vi.fn(),
  getTauriCore: vi.fn(),
}));

import { buildKuboBinaryConfig } from "../kubo-bootstrap";
import type { PlatformInfo } from "@symbiosis-lab/moss-api";

const platform = (platformKey: string): PlatformInfo =>
  ({ os: "darwin", arch: "arm64", platformKey }) as PlatformInfo;

describe("buildKuboBinaryConfig", () => {
  it("maps supported platforms to pinned official dist archives", () => {
    const cfg = buildKuboBinaryConfig(platform("darwin-arm64"));
    expect(cfg?.binary_name).toBe("ipfs");
    const source = cfg?.sources["darwin-arm64"];
    expect(source?.direct_url).toMatch(
      /^https:\/\/dist\.ipfs\.tech\/kubo\/v[\d.]+\/kubo_v[\d.]+_darwin-arm64\.tar\.gz$/,
    );
    expect(source?.archive_format).toBe("tar_gz");
    expect(cfg?.archive_layout?.binary_path).toBe("kubo/ipfs");
  });

  it("covers darwin-x64 and linux-x64", () => {
    expect(buildKuboBinaryConfig(platform("darwin-x64"))?.sources["darwin-x64"]?.direct_url).toContain(
      "darwin-amd64",
    );
    expect(buildKuboBinaryConfig(platform("linux-x64"))?.sources["linux-x64"]?.direct_url).toContain(
      "linux-amd64",
    );
  });

  it("returns null for unsupported platforms (guidance panel fallback)", () => {
    expect(buildKuboBinaryConfig(platform("windows-x64"))).toBeNull();
  });
});
