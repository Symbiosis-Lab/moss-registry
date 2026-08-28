/**
 * Where the local node's gateway actually is.
 *
 * The gateway port is the node's to choose, not ours to assume. Kubo ships
 * with 8080, which on a moss machine is already taken: moss's own preview
 * server holds it, so a daemon started with the default config either fails to
 * bind or, worse, the plugin's "Local gateway" links land on moss's refusal
 * page. Both were observed live.
 *
 * So every local gateway URL and every pre-spawn port check reads the address
 * from the node itself — over the RPC when the daemon is up (authoritative and
 * remote-capable), off the `ipfs` binary when it is not.
 */

import { executeBinary } from "@symbiosis-lab/moss-api";
import type { IpfsSettings } from "./types";
import { kuboRpcBase } from "./gateways";
import { getUrl, postRaw } from "./http";
import { API_TIMEOUT_MS, DAEMON_PROBE_TIMEOUT_MS } from "./constants";

/** Ports offered when the configured one is taken. */
const ALTERNATE_GATEWAY_PORTS = [8081, 8082, 8090, 48080];

/**
 * The TCP port in a multiaddr like "/ip4/127.0.0.1/tcp/8080", or null when the
 * address is not TCP (a unix socket, say) and no port applies.
 */
export function portFromMultiaddr(addr: string): number | null {
  const match = /\/tcp\/(\d{1,5})(?:\/|$)/.exec(addr.trim());
  if (!match) return null;
  const port = Number(match[1]);
  return port > 0 && port < 65536 ? port : null;
}

/** Kubo's config values arrive as a JSON scalar, so "…" needs unquoting. */
function unquote(text: string): string {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "string" ? parsed : trimmed;
  } catch {
    return trimmed;
  }
}

/** The gateway multiaddr according to the `ipfs` binary (daemon may be down). */
export async function gatewayAddrFromBinary(): Promise<string | null> {
  try {
    const res = await executeBinary({
      binaryPath: "ipfs",
      args: ["config", "Addresses.Gateway"],
      timeoutMs: 10_000,
    });
    if (!res.success) return null;
    const value = unquote(res.stdout ?? "");
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** The gateway multiaddr according to a running daemon's RPC. */
export async function gatewayAddrFromRpc(settings: IpfsSettings): Promise<string | null> {
  try {
    const res = await postRaw(
      `${kuboRpcBase(settings)}/api/v0/config?arg=Addresses.Gateway`,
      {},
      { timeoutMs: API_TIMEOUT_MS },
    );
    if (!res.ok) return null;
    const parsed = JSON.parse(res.text()) as { Value?: unknown };
    return typeof parsed.Value === "string" && parsed.Value.length > 0 ? parsed.Value : null;
  } catch {
    return null;
  }
}

/**
 * Whether `port` is free on loopback. Anything that answers — a 404 from
 * moss's preview server counts — means the daemon cannot have it.
 */
export async function portIsFree(port: number): Promise<boolean> {
  const res = await getUrl(`http://127.0.0.1:${port}/`, DAEMON_PROBE_TIMEOUT_MS);
  return res.status === 0;
}

/** The first alternate port nothing is listening on, or null if all are taken. */
export async function findFreeGatewayPort(): Promise<number | null> {
  for (const port of ALTERNATE_GATEWAY_PORTS) {
    if (await portIsFree(port)) return port;
  }
  return null;
}

/**
 * Point the node's gateway at `port`, bound to loopback as Kubo's own default
 * is. This edits the user's IPFS config, so every caller must have their
 * explicit consent first.
 */
export async function setGatewayPort(port: number): Promise<boolean> {
  try {
    const res = await executeBinary({
      binaryPath: "ipfs",
      args: ["config", "Addresses.Gateway", `/ip4/127.0.0.1/tcp/${port}`],
      timeoutMs: 10_000,
    });
    return !!res.success;
  } catch {
    return false;
  }
}

/**
 * Host:port for building local gateway links, from the running daemon.
 * `localhost` rather than 127.0.0.1 because the subdomain form
 * (<cid>.ipfs.localhost:PORT) is what makes a site's root-absolute asset paths
 * resolve; browsers resolve *.localhost to loopback. Returns undefined when
 * the node won't say — the caller then emits no local link at all rather than
 * a guess that 404s.
 */
export async function localGatewayHost(settings: IpfsSettings): Promise<string | undefined> {
  const addr = await gatewayAddrFromRpc(settings);
  const port = addr ? portFromMultiaddr(addr) : null;
  return port === null ? undefined : `localhost:${port}`;
}
