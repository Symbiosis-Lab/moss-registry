/**
 * The liveness verdict — one binary answer, never a prediction.
 *
 * These exist because the old copy said "the address should resolve within a
 * minute" and the user hit it during an outage where nothing resolved within a
 * minute or at all. The user-facing sentences moved to moss with the toast
 * itself (single-author consolidation, 2026-08-17); what remains here is the
 * verdict, which travels as data in `deployment.metadata.liveness`.
 */

import { describe, it, expect } from "vitest";
import { classifyLiveness } from "../liveness";

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
