/**
 * The publish setup gate (ADR-072), through the hook moss actually calls. What
 * matters here is that every answer is DATA — a message and named actions moss
 * draws — that every action offered is one moss can carry out, and that a token
 * the service refused is reported to moss before the need goes back, so the
 * user is asked for a new one instead of being handed the dead one again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const api = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  rejected: [] as string[],
}));

vi.mock("@symbiosis-lab/moss-api", () => ({
  setMessageContext: vi.fn(),
  reportProgress: vi.fn(),
  reportError: vi.fn(),
  showToast: vi.fn(),
  getSecret: vi.fn(async (key: string) => api.secrets.get(key) ?? null),
  rejectSecret: vi.fn(async (key: string) => {
    api.rejected.push(key);
    api.secrets.delete(key);
  }),
}));

const net = vi.hoisted(() => ({
  authStatus: 200,
  daemonUp: false,
}));
vi.mock("../http", () => ({
  getWithHeaders: vi.fn(async () => ({ ok: net.authStatus < 400, status: net.authStatus })),
  postRaw: vi.fn(async () => ({ ok: net.daemonUp, status: net.daemonUp ? 200 : 0 })),
  postMultipart: vi.fn(),
  toMultipartFiles: vi.fn(() => []),
  parseJson: vi.fn(),
  getUrl: vi.fn(),
}));

const node = vi.hoisted(() => ({
  installed: true,
  bootstrap: { ok: true, installed: true } as Record<string, unknown>,
  freePort: 8082 as number | null,
  portChanged: true,
  startsDaemon: true,
}));
vi.mock("../kubo-bootstrap", () => ({
  kuboInstalled: vi.fn(async () => node.installed),
  bootstrapLocalNode: vi.fn(async () => {
    if (node.bootstrap.ok && node.startsDaemon) net.daemonUp = true;
    return node.bootstrap;
  }),
  diagnoseDaemon: vi.fn(async () => ({ alive: false, log: "" })),
  describeDaemonFailure: vi.fn(() => "The node started and then stopped."),
}));
const gateway = vi.hoisted(() => ({ portSet: [] as number[] }));
vi.mock("../kubo-gateway", () => ({
  findFreeGatewayPort: vi.fn(async () => node.freePort),
  setGatewayPort: vi.fn(async (port: number) => {
    gateway.portSet.push(port);
    return node.portChanged;
  }),
}));

import { check_setup } from "../setup";
import { CHANGE_PORT_ACTION, START_DAEMON_ACTION } from "../providers/local";
import { PINATA_JWT_KEY } from "../credentials";

const pinata = (action?: string) => ({ project_path: "/site", config: { provider: "pinata" }, action });
const local = (action?: string) => ({ project_path: "/site", config: { provider: "local" }, action });

beforeEach(() => {
  api.secrets.clear();
  api.rejected = [];
  net.authStatus = 200;
  net.daemonUp = false;
  node.installed = true;
  node.bootstrap = { ok: true, installed: true };
  node.freePort = 8082;
  node.portChanged = true;
  node.startsDaemon = true;
  gateway.portSet = [];
});

describe("check_setup — Pinata", () => {
  it("is ready when Pinata still accepts the token moss holds", async () => {
    api.secrets.set(PINATA_JWT_KEY, "JWT");
    const { setup } = await check_setup(pinata());
    expect(setup?.ready).toBe(true);
  });

  it("says a token is missing without offering a button moss cannot honour", async () => {
    const { setup } = await check_setup(pinata());
    expect(setup?.ready).toBe(false);
    expect(setup?.needs?.[0].id).toBe("pinata_token");
    // moss collects the DECLARED credential in its own modal on the next
    // Publish click. A button here could only re-probe and hand back this
    // same need forever.
    expect(setup?.needs?.[0].actions ?? []).toEqual([]);
  });

  it("rejects a refused token BEFORE answering, so the modal collects a new one", async () => {
    api.secrets.set(PINATA_JWT_KEY, "REVOKED");
    net.authStatus = 401;
    const { setup } = await check_setup(pinata());
    expect(api.rejected).toEqual([PINATA_JWT_KEY]);
    expect(setup?.ready).toBe(false);
    expect(setup?.needs?.[0].actions ?? []).toEqual([]);
  });

  it("does not throw away a working token when the network is the problem", async () => {
    api.secrets.set(PINATA_JWT_KEY, "JWT");
    net.authStatus = 503;
    const { setup } = await check_setup(pinata());
    expect(api.rejected).toEqual([]);
    expect(setup?.ready).toBe(true);
  });
});

describe("check_setup — the local node", () => {
  it("is ready when the daemon answers", async () => {
    net.daemonUp = true;
    const { setup } = await check_setup(local());
    expect(setup?.ready).toBe(true);
  });

  it("offers to start an installed node, saying what that costs first", async () => {
    const { setup } = await check_setup(local());
    const need = setup?.needs?.[0];
    expect(need?.id).toBe("daemon_stopped");
    const action = need?.actions?.[0];
    expect(action?.id).toBe(START_DAEMON_ACTION);
    // The three facts a user cannot discover afterwards, before the click.
    expect(action?.consent).toMatch(/after you quit moss/);
    expect(action?.consent).toMatch(/restart your computer/);
    expect(action?.consent).toMatch(/ipfs shutdown/);
  });

  it("explains an install with no button to press when there is nothing to start", async () => {
    node.installed = false;
    const { setup } = await check_setup(local());
    expect(setup?.needs?.[0].id).toBe("kubo_missing");
    expect(setup?.needs?.[0].actions ?? []).toEqual([]);
  });

  it("starts the node when the user clicks, and answers ready once it is up", async () => {
    const { setup } = await check_setup(local(START_DAEMON_ACTION));
    expect(setup?.ready).toBe(true);
  });

  it("offers a free port when the node's gateway port is taken", async () => {
    node.startsDaemon = false;
    node.bootstrap = { ok: false, installed: true, reason: "gateway port busy", gatewayPortTaken: 8080 };
    const { setup } = await check_setup(local(START_DAEMON_ACTION));
    const need = setup?.needs?.[0];
    expect(need?.id).toBe("gateway_port");
    expect(need?.message).toMatch(/8080/);
    // The offered port travels IN the id: a second scan at click time could
    // return a different free port and silently move the node somewhere the
    // button never named.
    expect(need?.actions?.[0]).toMatchObject({
      id: `${CHANGE_PORT_ACTION}:8082`,
      label: "Use port 8082",
    });
  });

  it("moves the gateway port and starts the node when that offer is taken", async () => {
    node.bootstrap = { ok: true, installed: true };
    const { setup } = await check_setup(local(`${CHANGE_PORT_ACTION}:8082`));
    expect(setup?.ready).toBe(true);
    expect(gateway.portSet).toEqual([8082]);
  });

  it("does not try to start a node that lives on another machine", async () => {
    const { setup } = await check_setup({
      project_path: "/site",
      config: { provider: "local", node_rpc: "http://my-pi:5001" },
    });
    expect(setup?.needs?.[0].id).toBe("node_unreachable");
    expect(setup?.needs?.[0].actions ?? []).toEqual([]);
  });
});
