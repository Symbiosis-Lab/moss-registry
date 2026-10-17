import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  awaiting: vi.fn(),
  succeeded: vi.fn(),
  failed: vi.fn(),
  startTask: vi.fn(),
  resolveGitPath: vi.fn(),
}));

vi.mock("@symbiosis-lab/moss-api", () => ({ startTask: mocks.startTask }));
vi.mock("../utils", () => ({
  resolveGitPath: mocks.resolveGitPath,
  sleep: () => Promise.resolve(),
}));

import { waitForGit } from "../git-download";

describe("waitForGit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.awaiting.mockResolvedValue(undefined);
    mocks.succeeded.mockResolvedValue(undefined);
    mocks.failed.mockResolvedValue(undefined);
    mocks.startTask.mockResolvedValue({
      id: 1,
      awaiting: mocks.awaiting,
      succeeded: mocks.succeeded,
      failed: mocks.failed,
    });
  });

  it("offers the git download as the awaiting escape", async () => {
    mocks.resolveGitPath.mockResolvedValueOnce("/opt/git");
    await waitForGit();
    expect(mocks.awaiting).toHaveBeenCalledWith(
      expect.stringContaining("Git is needed"),
      "",
      "download-tool:git",
    );
  });

  it("returns the path once git resolves and ends the task as succeeded", async () => {
    mocks.resolveGitPath
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("/opt/git");
    await expect(waitForGit()).resolves.toBe("/opt/git");
    expect(mocks.resolveGitPath).toHaveBeenCalledTimes(3);
    expect(mocks.succeeded).toHaveBeenCalled();
    expect(mocks.failed).not.toHaveBeenCalled();
  });

  it("gives up once the wait cap has passed and ends the task as failed", async () => {
    mocks.resolveGitPath.mockResolvedValue(null);
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValue(10 * 60 * 1000 + 1);
    await expect(waitForGit()).resolves.toBeNull();
    expect(mocks.failed).toHaveBeenCalled();
    expect(mocks.succeeded).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
