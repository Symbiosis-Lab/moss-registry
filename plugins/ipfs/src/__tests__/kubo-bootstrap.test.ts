import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  binaryOk: true,
  os: "darwin" as string,
  /** Gateway multiaddr the `ipfs config` read returns. */
  gatewayAddr: "/ip4/127.0.0.1/tcp/8080",
  /** Ports something is already listening on. */
  busyPorts: [] as number[],
  spawnStdout: "4242\n/tmp/moss-ipfs-daemon.log",
  /** What `kill -0` + `tail` reports back. */
  diagnosis: "DEAD\nError: bind: address already in use",
  calls: [] as Array<{ binaryPath: string; args: string[] }>,
}));

vi.mock("@symbiosis-lab/moss-api", () => ({
  setMessageContext: vi.fn(),
  reportProgress: vi.fn(),
  reportError: vi.fn(),
  showToast: vi.fn(),
  closeBrowser: vi.fn(),
  httpPost: vi.fn(),
  executeBinary: vi.fn(async (cfg: { binaryPath: string; args: string[] }) => {
    h.calls.push(cfg);
    if (cfg.binaryPath === "ipfs" && cfg.args[0] === "version") {
      return { success: h.binaryOk, stdout: "0.42.0", stderr: "" };
    }
    if (cfg.binaryPath === "ipfs" && cfg.args[0] === "config" && cfg.args.length === 2) {
      return { success: true, stdout: h.gatewayAddr, stderr: "" };
    }
    if (cfg.binaryPath === "/bin/sh" && cfg.args[1].includes("kill -0")) {
      return { success: true, stdout: h.diagnosis, stderr: "" };
    }
    if (cfg.binaryPath === "/bin/sh") {
      return { success: true, stdout: h.spawnStdout, stderr: "" };
    }
    return { success: true, stdout: "", stderr: "" };
  }),
  getPlatformInfo: vi.fn(async () => ({ os: h.os, arch: "arm64", platformKey: `${h.os}-arm64` })),
  // A port with a listener answers; a free one fails at the transport.
  fetchUrl: vi.fn(async (url: string) => {
    const port = Number(/:(\d+)\//.exec(url)?.[1]);
    if (h.busyPorts.includes(port)) return { ok: false, status: 404 };
    throw new Error("connection refused");
  }),
}));

import {
  kuboInstalled,
  bootstrapLocalNode,
  parseSpawnOutput,
  diagnoseDaemon,
  describeDaemonFailure,
} from "../kubo-bootstrap";

beforeEach(() => {
  h.binaryOk = true;
  h.os = "darwin";
  h.gatewayAddr = "/ip4/127.0.0.1/tcp/8080";
  h.busyPorts = [];
  h.spawnStdout = "4242\n/tmp/moss-ipfs-daemon.log";
  h.diagnosis = "DEAD\nError: bind: address already in use";
  h.calls = [];
  vi.clearAllMocks();
});

describe("kuboInstalled", () => {
  it("reflects the executeBinary probe", async () => {
    expect(await kuboInstalled()).toBe(true);
    h.binaryOk = false;
    expect(await kuboInstalled()).toBe(false);
  });
});

describe("bootstrapLocalNode", () => {
  it("NEVER downloads: missing binary → install guidance, no further calls", async () => {
    h.binaryOk = false;
    const result = await bootstrapLocalNode(() => {});
    expect(result.ok).toBe(false);
    expect(result.installed).toBe(false);
    expect(result.reason).toMatch(/isn't installed/);
    // Only the detection probe ran — nothing resembling a fetch or install.
    expect(h.calls).toHaveLength(1);
  });

  it("starts an installed node and keeps the pid and log to ask about later", async () => {
    const statuses: string[] = [];
    const result = await bootstrapLocalNode((m) => statuses.push(m));
    expect(result.ok).toBe(true);
    expect(h.calls.some((c) => c.binaryPath === "ipfs" && c.args[0] === "init")).toBe(true);
    const spawn = h.calls.find((c) => c.binaryPath === "/bin/sh");
    expect(spawn?.args[1]).toContain("ipfs daemon");
    // The daemon's own output is captured, not discarded to /dev/null.
    expect(spawn?.args[1]).not.toContain("/dev/null");
    expect(result.daemon).toEqual({ pid: 4242, logPath: "/tmp/moss-ipfs-daemon.log" });
    expect(statuses.length).toBeGreaterThan(0);
  });

  it("refuses to spawn into a taken gateway port, and names the port", async () => {
    // Kubo's default is 8080, which moss's own preview server holds. Spawning
    // anyway produced a daemon that died seconds later, invisibly.
    h.busyPorts = [8080];
    const result = await bootstrapLocalNode(() => {});
    expect(result.ok).toBe(false);
    expect(result.gatewayPortTaken).toBe(8080);
    expect(result.reason).toMatch(/8080/);
    expect(result.reason).toMatch(/preview server/);
    expect(h.calls.some((c) => c.binaryPath === "/bin/sh")).toBe(false);
  });

  it("reads the port from the node's own config, not a constant", async () => {
    h.gatewayAddr = "/ip4/127.0.0.1/tcp/9090";
    h.busyPorts = [9090];
    const result = await bootstrapLocalNode(() => {});
    expect(result.gatewayPortTaken).toBe(9090);
    expect(result.reason).not.toMatch(/preview server/);
  });

  it("treats a spawn that produced no pid as a failure, whatever the shell said", async () => {
    // `nohup … &` exits 0 the instant the fork succeeds, so a successful shell
    // is no evidence at all that a daemon exists.
    h.spawnStdout = "";
    const result = await bootstrapLocalNode(() => {});
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Could not start/);
  });

  it("is guidance-only on Windows", async () => {
    h.os = "windows";
    const result = await bootstrapLocalNode(() => {});
    expect(result.ok).toBe(false);
    expect(result.installed).toBe(true);
    expect(result.reason).toMatch(/Windows/);
  });
});

describe("parseSpawnOutput", () => {
  it("reads the pid and log path", () => {
    expect(parseSpawnOutput("123\n/tmp/x.log\n")).toEqual({ pid: 123, logPath: "/tmp/x.log" });
  });
  it("returns null when there is nothing to observe", () => {
    expect(parseSpawnOutput("")).toBeNull();
    expect(parseSpawnOutput("not-a-pid\n/tmp/x.log")).toBeNull();
    expect(parseSpawnOutput("123\n")).toBeNull();
  });
});

describe("diagnoseDaemon / describeDaemonFailure", () => {
  it("reports the daemon's own last words when it died", async () => {
    const d = await diagnoseDaemon({ pid: 4242, logPath: "/tmp/moss-ipfs-daemon.log" });
    expect(d.alive).toBe(false);
    const message = describeDaemonFailure(d);
    expect(message).toMatch(/quit right after starting/);
    expect(message).toMatch(/address already in use/);
    // Never the message that describes our waiting instead of their problem.
    expect(message).not.toMatch(/did not come up in time/);
  });

  it("distinguishes a live-but-slow daemon from a dead one", async () => {
    h.diagnosis = "ALIVE\nSwarm listening on /ip4/…";
    const d = await diagnoseDaemon({ pid: 4242, logPath: "/tmp/x.log" });
    expect(d.alive).toBe(true);
    expect(describeDaemonFailure(d)).toMatch(/running but/);
  });

  it("says so plainly when it could not tell", () => {
    expect(describeDaemonFailure(null)).toMatch(/could not tell why/);
    expect(describeDaemonFailure({ alive: false, log: "" })).toMatch(/without saying why/);
  });
});
