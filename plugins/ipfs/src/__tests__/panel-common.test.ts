import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  listener: null as ((payload: unknown) => unknown) | null,
  awaiting: [] as Array<{ directive: string; venue: string }>,
  terminal: [] as string[],
  unlistened: 0,
}));

vi.mock("@symbiosis-lab/moss-api", () => ({
  openBrowserWithHtml: vi.fn(async () => {}),
  onEvent: vi.fn(async (_name: string, cb: (p: unknown) => unknown) => {
    h.listener = cb;
    return () => {
      h.unlistened++;
    };
  }),
  startTask: vi.fn(async () => ({
    id: "1",
    progress: vi.fn(async () => {}),
    awaiting: vi.fn(async (directive: string, venue: string) => {
      h.awaiting.push({ directive, venue });
    }),
    advise: vi.fn(async () => {}),
    succeeded: vi.fn(async () => {
      h.terminal.push("succeeded");
    }),
    failed: vi.fn(async () => {
      h.terminal.push("failed");
    }),
    cancelled: vi.fn(async () => {}),
  })),
}));

import { showPanel } from "../panel-common";

beforeEach(() => {
  h.listener = null;
  h.awaiting = [];
  h.terminal = [];
  h.unlistened = 0;
  vi.clearAllMocks();
});

describe("showPanel", () => {
  it("declares the wait to moss so the watchdog stands down, then resolves on the event", async () => {
    // Before ADR-015's awaiting(), this shipped fake 10s progress pings whose
    // only job was convincing the inactivity watchdog someone was working.
    const pending = showPanel<{ jwt: string }>(
      "<html></html>",
      "ipfs:test",
      "Paste your token",
      "the Connect panel",
    );
    await vi.waitFor(() => expect(h.awaiting).toHaveLength(1));
    expect(h.awaiting[0]).toEqual({ directive: "Paste your token", venue: "the Connect panel" });

    h.listener?.({ jwt: "TOKEN" });
    expect(await pending).toEqual({ jwt: "TOKEN" });
    expect(h.terminal).toEqual(["succeeded"]);
    expect(h.unlistened).toBe(1);
  });

  it("keeps waiting past any self-imposed cap — a person is reading it", async () => {
    vi.useFakeTimers();
    try {
      const pending = showPanel<{ ok: boolean }>("<html></html>", "ipfs:test", "Do a thing", "the panel");
      await vi.waitFor(() => expect(h.awaiting).toHaveLength(1));
      // The old implementation resolved null at 300s and closed the panel.
      await vi.advanceTimersByTimeAsync(600_000);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      h.listener?.({ ok: true });
      expect(await pending).toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
