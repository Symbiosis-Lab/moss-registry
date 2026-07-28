/**
 * Unit tests for utils.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as mossApi from "@symbiosis-lab/moss-api";

// Mock the moss-api module
vi.mock("@symbiosis-lab/moss-api", () => ({
  setMessageContext: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  reportProgress: vi.fn().mockResolvedValue(undefined),
  reportError: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocking
import {
  setCurrentHookName,
  reportProgress,
  reportError,
  sleep,
} from "../utils";

describe("utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("setCurrentHookName", () => {
    it("calls setMessageContext with plugin name and hook name", () => {
      setCurrentHookName("testHook");

      expect(mossApi.setMessageContext).toHaveBeenCalledWith("github", "testHook");
    });
  });

  describe("reportProgress", () => {
    it("forwards to SDK reportProgress", async () => {
      await reportProgress("building", 5, 10, "Processing files...");

      expect(mossApi.reportProgress).toHaveBeenCalledWith(
        "building",
        5,
        10,
        "Processing files..."
      );
    });

    it("works without optional message", async () => {
      await reportProgress("uploading", 3, 5);

      expect(mossApi.reportProgress).toHaveBeenCalledWith(
        "uploading",
        3,
        5,
        undefined
      );
    });
  });

  describe("reportError", () => {
    it("forwards to SDK reportError", async () => {
      await reportError("Something went wrong", "deployment");

      expect(mossApi.reportError).toHaveBeenCalledWith(
        "Something went wrong",
        "deployment",
        false
      );
    });

    it("handles fatal errors", async () => {
      await reportError("Critical failure", "authentication", true);

      expect(mossApi.reportError).toHaveBeenCalledWith(
        "Critical failure",
        "authentication",
        true
      );
    });

    it("works without optional context", async () => {
      await reportError("Error occurred");

      expect(mossApi.reportError).toHaveBeenCalledWith(
        "Error occurred",
        undefined,
        false
      );
    });
  });

  describe("sleep", () => {
    it("resolves after specified time", async () => {
      vi.useFakeTimers();

      const promise = sleep(100);

      // Fast-forward time
      vi.advanceTimersByTime(100);

      await expect(promise).resolves.toBeUndefined();

      vi.useRealTimers();
    });

    it("delays execution for the correct duration", async () => {
      vi.useFakeTimers();

      let resolved = false;
      sleep(50).then(() => { resolved = true; });

      // Not resolved yet
      expect(resolved).toBe(false);

      // Advance 49ms - still not resolved
      vi.advanceTimersByTime(49);
      await Promise.resolve(); // flush microtasks
      expect(resolved).toBe(false);

      // Advance 1 more ms - now resolved
      vi.advanceTimersByTime(1);
      await Promise.resolve(); // flush microtasks
      expect(resolved).toBe(true);

      vi.useRealTimers();
    });
  });
});
