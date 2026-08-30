import { describe, it, expect, vi, beforeEach } from "vitest";

// checkSetup's contract: verdicts only, moss draws every dialog. These tests
// pin the blocker ids (they come back as ctx.action) and the re-ask flow.

const h = vi.hoisted(() => ({
  jwt: null as string | null,
  rejected: [] as string[],
  fresh: null as string | null,
  authStatus: 200,
  daemonUp: false,
  installed: true,
  bootstrap: { ok: true, daemon: undefined } as Record<string, unknown>,
  portMoves: [] as number[],
}));

vi.mock("../credentials", () => ({
  getPinataJwt: vi.fn(async () => h.jwt),
  rejectPinataJwt: vi.fn(async (detail: string) => {
    h.rejected.push(detail);
    return h.fresh;
  }),
}));

vi.mock("../http", () => ({
  getWithHeaders: vi.fn(async () => ({ status: h.authStatus })),
  postRaw: vi.fn(async () => {
    if (!h.daemonUp) throw new Error("connection refused");
    return { ok: true };
  }),
}));

vi.mock("../kubo-bootstrap", () => ({
  kuboInstalled: vi.fn(async () => h.installed),
  bootstrapLocalNode: vi.fn(async () => {
    // A successful start makes the RPC answer on the next probe.
    if (h.bootstrap.ok) h.daemonUp = true;
    return h.bootstrap;
  }),
  diagnoseDaemon: vi.fn(async () => null),
  describeDaemonFailure: vi.fn(() => "The IPFS node did not come up."),
}));

vi.mock("../kubo-gateway", () => ({
  findFreeGatewayPort: vi.fn(async () => 8081),
  setGatewayPort: vi.fn(async (port: number) => {
    h.portMoves.push(port);
    return true;
  }),
}));

vi.mock("../utils", () => ({
  reportProgress: vi.fn(async () => {}),
  sleep: vi.fn(async () => {}),
}));

import { checkSetup } from "../setup";

const PINATA = { settings: { provider: "pinata" } };
const LOCAL = { settings: { provider: "local" } };

beforeEach(() => {
  h.jwt = null;
  h.rejected = [];
  h.fresh = null;
  h.authStatus = 200;
  h.daemonUp = false;
  h.installed = true;
  h.bootstrap = { ok: true, daemon: undefined };
  h.portMoves = [];
  vi.clearAllMocks();
});

describe("checkSetup — Pinata", () => {
  it("blocks when moss holds no token (headless, or the user cancelled)", async () => {
    const v = await checkSetup(PINATA);
    expect(v).toMatchObject({ status: "blocked" });
    expect(v.blockers?.[0].id).toBe("pinata_auth");
  });

  it("is ready when the stored token still authenticates", async () => {
    h.jwt = "GOOD";
    expect(await checkSetup(PINATA)).toEqual({ status: "ready" });
    expect(h.rejected).toHaveLength(0);
  });

  it("rejects a 401'd token with the reason, and accepts the replacement", async () => {
    h.jwt = "STALE";
    h.authStatus = 401;
    h.fresh = "FRESH";
    const { getWithHeaders } = await import("../http");
    vi.mocked(getWithHeaders)
      .mockResolvedValueOnce({ status: 401 } as never)
      .mockResolvedValueOnce({ status: 200 } as never);
    expect(await checkSetup(PINATA)).toEqual({ status: "ready" });
    expect(h.rejected).toEqual(["Pinata says this token is no longer valid."]);
  });

  it("blocks when the user declines to replace a rejected token", async () => {
    h.jwt = "STALE";
    h.authStatus = 401;
    h.fresh = null;
    const v = await checkSetup(PINATA);
    expect(v.blockers?.[0].id).toBe("pinata_auth");
    expect(v.blockers?.[0].message).toMatch(/valid API token/);
  });

  it("does not block on transport failure — the upload is the final arbiter", async () => {
    h.jwt = "GOOD";
    h.authStatus = 0;
    expect(await checkSetup(PINATA)).toEqual({ status: "ready" });
    expect(h.rejected).toHaveLength(0);
  });
});

describe("checkSetup — local Kubo", () => {
  it("is ready when the daemon answers", async () => {
    h.daemonUp = true;
    expect(await checkSetup(LOCAL)).toEqual({ status: "ready" });
  });

  it("offers a recheck (not a start) for a remote node moss doesn't own", async () => {
    const v = await checkSetup({ settings: { provider: "local", node_rpc: "http://10.0.0.5:5001" } });
    expect(v.blockers?.[0].id).toBe("recheck");
    expect(v.blockers?.[0].message).toContain("10.0.0.5");
  });

  it("points at IPFS Desktop when Kubo isn't installed", async () => {
    h.installed = false;
    const v = await checkSetup(LOCAL);
    expect(v.blockers?.[0].id).toBe("recheck");
    expect(v.blockers?.[0].message).toContain("ipfs-desktop");
  });

  it("asks consent before starting a daemon, stating what the click agrees to", async () => {
    const v = await checkSetup(LOCAL);
    const b = v.blockers?.[0];
    expect(b?.id).toBe("start_daemon");
    expect(b?.message).toMatch(/keeps running after you quit moss/);
    expect(b?.message).toMatch(/ipfs shutdown/);
    expect(b?.form?.submit).toBe("Start IPFS");
  });

  it("the start_daemon action starts the node and lands ready", async () => {
    const v = await checkSetup({ ...LOCAL, action: "start_daemon" });
    const { bootstrapLocalNode } = await import("../kubo-bootstrap");
    expect(vi.mocked(bootstrapLocalNode)).toHaveBeenCalled();
    expect(v).toEqual({ status: "ready" });
  });

  it("offers a port move (its own consent) when the gateway port is taken", async () => {
    h.bootstrap = { ok: false, reason: "Port 8080 is in use.", gatewayPortTaken: 8080 };
    const v = await checkSetup({ ...LOCAL, action: "start_daemon" });
    expect(v.blockers?.[0].id).toBe("change_port");
    expect(v.blockers?.[0].message).toMatch(/IPFS node's own configuration/);
  });

  it("the change_port action re-derives the free port at click time", async () => {
    const v = await checkSetup({ ...LOCAL, action: "change_port" });
    expect(h.portMoves).toEqual([8081]);
    expect(v).toEqual({ status: "ready" });
  });
});
