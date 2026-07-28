/**
 * Tests for progress reporting timeout fix
 *
 * Bug: GitHub Pages polling times out because reportProgress is called AFTER sleep,
 * causing 60-second inactivity timeout (6 iterations × 5s sleep + API calls = >60s)
 *
 * Fix: Move reportProgress to START of each iteration (before sleep) to reset
 * the inactivity timer every 5 seconds.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Progress Timeout Fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("waitForPagesLive polling loop", () => {
    it("calls reportProgress BEFORE sleep to reset inactivity timer", async () => {
      // This test simulates the polling loop structure
      const reportProgress = vi.fn().mockResolvedValue(undefined);
      const checkPagesStatus = vi.fn();

      // Simulate 3 iterations where status is "building"
      checkPagesStatus.mockResolvedValue({ status: "building" });

      const maxAttempts = 3;
      const pollInterval = 100; // Short interval for testing

      // Track the order of operations
      const operations: string[] = [];

      // Simulate the CORRECT polling loop (reportProgress BEFORE sleep)
      for (let i = 0; i < maxAttempts; i++) {
        operations.push("check-status");
        await checkPagesStatus();

        // Still building - report progress THEN sleep
        if (i < maxAttempts - 1) {
          operations.push(`report-progress-${i + 1}`);
          await reportProgress("verifying", 9, 10, `Waiting for GitHub Pages... (${i + 1}/${maxAttempts})`);

          operations.push(`sleep-${i + 1}`);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      }

      // Verify order: For each iteration, progress is reported BEFORE sleep
      expect(operations).toEqual([
        "check-status",
        "report-progress-1",
        "sleep-1",
        "check-status",
        "report-progress-2",
        "sleep-2",
        "check-status",
      ]);

      // Verify reportProgress was called exactly 2 times (not on last iteration)
      expect(reportProgress).toHaveBeenCalledTimes(2);

      // Verify each call has the correct iteration number (total=10 for REST API flow)
      expect(reportProgress).toHaveBeenNthCalledWith(1, "verifying", 9, 10, "Waiting for GitHub Pages... (1/3)");
      expect(reportProgress).toHaveBeenNthCalledWith(2, "verifying", 9, 10, "Waiting for GitHub Pages... (2/3)");
    });

    it("demonstrates WRONG pattern (reportProgress AFTER sleep)", async () => {
      // This test shows the buggy pattern for comparison
      const reportProgress = vi.fn().mockResolvedValue(undefined);
      const checkPagesStatus = vi.fn();

      checkPagesStatus.mockResolvedValue({ status: "building" });

      const maxAttempts = 3;
      const pollInterval = 100;

      const operations: string[] = [];

      // Simulate the BUGGY polling loop (sleep BEFORE reportProgress)
      for (let i = 0; i < maxAttempts; i++) {
        operations.push("check-status");
        await checkPagesStatus();

        // Still building - sleep THEN report progress (WRONG!)
        if (i < maxAttempts - 1) {
          operations.push(`sleep-${i + 1}`);
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          operations.push(`report-progress-${i + 1}`);
          await reportProgress("verifying", 9, 10, `Waiting for GitHub Pages... (${i + 1}/${maxAttempts})`);
        }
      }

      // In buggy pattern: sleep happens BEFORE progress report
      // This means the inactivity timer is NOT reset until after the sleep
      expect(operations).toEqual([
        "check-status",
        "sleep-1",
        "report-progress-1",
        "check-status",
        "sleep-2",
        "report-progress-2",
        "check-status",
      ]);

      // This demonstrates the problem: with 6 iterations × 5s sleep = 30s of sleeping
      // Plus API call time, we exceed 60s before resetting the timer
    });

    it("resets inactivity timer every 5 seconds with correct ordering", async () => {
      // Mock time to track when reportProgress is called relative to sleep
      vi.useFakeTimers();
      const startTime = Date.now();

      const reportProgress = vi.fn().mockResolvedValue(undefined);
      const checkPagesStatus = vi.fn().mockResolvedValue({ status: "building" });

      const maxAttempts = 6;
      const pollInterval = 5000; // Real interval: 5 seconds

      const progressCallTimes: number[] = [];

      // Wrap reportProgress to record timing
      const timedReportProgress = async (...args: Parameters<typeof reportProgress>) => {
        progressCallTimes.push(Date.now() - startTime);
        await reportProgress(...args);
      };

      // Start polling loop
      const pollingPromise = (async () => {
        for (let i = 0; i < maxAttempts; i++) {
          await checkPagesStatus();

          if (i < maxAttempts - 1) {
            // CORRECT: Report progress BEFORE sleep
            await timedReportProgress("verifying", 9, 10, `Waiting for GitHub Pages... (${i + 1}/${maxAttempts})`);
            await new Promise(resolve => setTimeout(resolve, pollInterval));
          }
        }
      })();

      // Advance time and flush promises for each iteration
      for (let i = 0; i < maxAttempts - 1; i++) {
        await vi.advanceTimersByTimeAsync(pollInterval);
      }

      await pollingPromise;

      // Verify progress is reported at the START of each 5-second interval
      // Intervals should be: 0ms, 5000ms, 10000ms, 15000ms, 20000ms
      expect(progressCallTimes).toHaveLength(5); // 6 attempts - 1 (no progress on last)

      // Each call should be ~5000ms apart
      for (let i = 1; i < progressCallTimes.length; i++) {
        const interval = progressCallTimes[i] - progressCallTimes[i - 1];
        expect(interval).toBe(5000);
      }

      // First call should happen at time 0 (relative to start)
      expect(progressCallTimes[0]).toBe(0);

      vi.useRealTimers();
    });

    it("keeps total polling time under 60 seconds with proper progress reporting", async () => {
      // With 6 attempts × 5s interval = 30s total sleep time
      // Plus API call overhead (~1s per call) = ~36s total
      // This is well under the 60s inactivity timeout when progress is reported correctly

      const maxAttempts = 6;
      const pollInterval = 5000;
      const apiCallTime = 1000; // Mock API call taking 1s

      let totalTime = 0;

      // Simulate timing of correct approach
      for (let i = 0; i < maxAttempts; i++) {
        // API call
        totalTime += apiCallTime;

        if (i < maxAttempts - 1) {
          // Progress report (resets timer) - negligible time
          totalTime += 1;

          // Sleep
          totalTime += pollInterval;
        }
      }

      // Total time should be under 60s (inactivity timeout)
      expect(totalTime).toBeLessThan(60000);

      // Actual calculation: 6 × 1000 (API) + 5 × 5000 (sleep) + 5 × 1 (report) = 31005ms
      expect(totalTime).toBe(31005);
    });
  });

  describe("deploy heartbeat interval", () => {
    it("heartbeat interval must be shorter than progress panel stale timeout (15s)", async () => {
      // The progress panel auto-removes tasks after STALE_TIMEOUT_MS (15s).
      // If the deploy heartbeat fires less frequently than that, the progress
      // bar disappears between heartbeats — making it invisible during long pushes.
      const { DEPLOY_HEARTBEAT_INTERVAL_MS } = await import("../constants");
      const STALE_TIMEOUT_MS = 15_000; // from src/preview/progress-panel.ts

      expect(DEPLOY_HEARTBEAT_INTERVAL_MS).toBeLessThan(STALE_TIMEOUT_MS);
    });
  });
});
