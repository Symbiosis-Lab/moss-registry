import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  busyPorts: [] as number[],
  rpcValue: "/ip4/127.0.0.1/tcp/8080" as string | null,
  rpcOk: true,
  configWrites: [] as string[][],
}));

vi.mock("@symbiosis-lab/moss-api", () => ({
  executeBinary: vi.fn(async (cfg: { args: string[] }) => {
    h.configWrites.push(cfg.args);
    return { success: true, stdout: "", stderr: "" };
  }),
  fetchUrl: vi.fn(async (url: string) => {
    const port = Number(/:(\d+)\//.exec(url)?.[1]);
    if (h.busyPorts.includes(port)) return { ok: true, status: 200 };
    throw new Error("connection refused");
  }),
  httpPost: vi.fn(async () => ({
    ok: h.rpcOk,
    status: h.rpcOk ? 200 : 500,
    text: () => JSON.stringify({ Key: "Addresses.Gateway", Value: h.rpcValue }),
  })),
  httpPostMultipart: vi.fn(),
  httpGet: vi.fn(),
}));

import {
  portFromMultiaddr,
  portIsFree,
  findFreeGatewayPort,
  setGatewayPort,
  localGatewayHost,
  gatewayAddrFromBinary,
} from "../kubo-gateway";

beforeEach(() => {
  h.busyPorts = [];
  h.rpcValue = "/ip4/127.0.0.1/tcp/8080";
  h.rpcOk = true;
  h.configWrites = [];
  vi.clearAllMocks();
});

describe("portFromMultiaddr", () => {
  it("reads the TCP port", () => {
    expect(portFromMultiaddr("/ip4/127.0.0.1/tcp/8080")).toBe(8080);
    expect(portFromMultiaddr("/ip4/0.0.0.0/tcp/9090/http")).toBe(9090);
  });
  it("returns null when no TCP port applies", () => {
    expect(portFromMultiaddr("/unix/var/run/ipfs.sock")).toBeNull();
    expect(portFromMultiaddr("")).toBeNull();
  });
});

describe("gatewayAddrFromBinary", () => {
  it("unquotes the JSON scalar `ipfs config` prints", async () => {
    // Kubo prints config values as JSON, so the multiaddr arrives quoted.
    const { executeBinary } = await import("@symbiosis-lab/moss-api");
    vi.mocked(executeBinary).mockResolvedValueOnce({
      success: true,
      stdout: '"/ip4/127.0.0.1/tcp/8081"\n',
      stderr: "",
    } as never);
    expect(await gatewayAddrFromBinary()).toBe("/ip4/127.0.0.1/tcp/8081");
  });
});

describe("port probing", () => {
  it("calls a port busy when ANYTHING answers — a moss 404 counts", async () => {
    h.busyPorts = [8080];
    expect(await portIsFree(8080)).toBe(false);
    expect(await portIsFree(8081)).toBe(true);
  });

  it("suggests the first port nothing is listening on", async () => {
    h.busyPorts = [8080, 8081];
    expect(await findFreeGatewayPort()).toBe(8082);
  });
});

describe("setGatewayPort", () => {
  it("writes the node's own config (consent is the caller's job)", async () => {
    expect(await setGatewayPort(8081)).toBe(true);
    expect(h.configWrites).toEqual([["config", "Addresses.Gateway", "/ip4/127.0.0.1/tcp/8081"]]);
  });
});

describe("localGatewayHost", () => {
  it("asks the running node where its gateway is", async () => {
    h.rpcValue = "/ip4/127.0.0.1/tcp/8081";
    expect(await localGatewayHost({ provider: "local", useIpns: true, relativeUrls: true })).toBe(
      "localhost:8081",
    );
  });

  it("returns undefined rather than guessing when the node won't say", async () => {
    h.rpcOk = false;
    expect(
      await localGatewayHost({ provider: "local", useIpns: true, relativeUrls: true }),
    ).toBeUndefined();
  });
});
