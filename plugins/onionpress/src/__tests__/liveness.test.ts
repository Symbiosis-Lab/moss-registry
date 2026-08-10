/**
 * The liveness verdict — one binary answer, never a prediction.
 *
 * These exist because the old copy said "the address should resolve within a
 * minute" and the user hit it during an outage where nothing resolved within a
 * minute or at all.
 */

import { describe, it, expect } from "vitest";
import { classifyLiveness, livenessMessage, livenessToastVariant } from "../liveness";

describe("classifyLiveness", () => {
  it("a confirmed Tor-routed fetch is live", () => {
    expect(classifyLiveness(true, "200")).toBe("live");
  });

  it("a confirmed failure is not live", () => {
    expect(classifyLiveness(false, "000")).toBe("not-live");
  });

  it("an unresolved check is neither — it is checking", () => {
    // The common case: descriptor publication routinely outlasts the poll
    // window. Calling this a success is the overclaim; calling it a failure is
    // the overclaim in the other direction.
    expect(classifyLiveness(null, null)).toBe("checking");
    expect(classifyLiveness(undefined)).toBe("checking");
  });

  it("OnionHeaven answering is NOT live, whatever the boolean says", () => {
    // Failover serves 302s to a Wayback snapshot. For the post the user just
    // published, that snapshot predates it; for a new site there is nothing
    // there at all. Reporting it as live is moss#917.
    expect(classifyLiveness(false, "takeover")).toBe("not-live");
    expect(classifyLiveness(true, "takeover")).toBe("not-live");
  });
});

describe("livenessMessage", () => {
  it("promises nothing about when", () => {
    for (const verdict of ["live", "not-live", "checking"] as const) {
      const message = livenessMessage(verdict);
      expect(message).not.toMatch(/minute|shortly|soon|should resolve/i);
    }
  });

  it("only the live verdict reads as success", () => {
    expect(livenessToastVariant("live")).toBe("success");
    expect(livenessToastVariant("not-live")).toBe("info");
    expect(livenessToastVariant("checking")).toBe("info");
  });

  it("says live plainly when it is live", () => {
    expect(livenessMessage("live")).toBe("Your site is live.");
  });
});
