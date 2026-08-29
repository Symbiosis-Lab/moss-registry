/**
 * Gateway / protocol URL builders.
 *
 * Pure functions, heavily unit-tested. Two forms exist:
 *   - subdomain: https://<cid>.ipfs.<host>   (origin-isolated; makes root-absolute
 *     AND relative asset links resolve correctly — the safe default for sites)
 *   - path:      https://<host>/ipfs/<cid>   (works everywhere; root-absolute links
 *     that assume the site is at "/" will break)
 *
 * Subdomain form requires a CIDv1 (case-insensitive base32); CIDv0 falls back to
 * the path form.
 */

import {
  PUBLIC_GATEWAY_DWEB,
  PUBLIC_GATEWAY_W3S,
  PINATA_DEFAULT_GATEWAY,
  DEFAULT_KUBO_RPC,
} from "./constants";
import type { DeployAddress } from "@symbiosis-lab/moss-api";
import type { IpfsSettings, ProviderId } from "./types";

// ---------------------------------------------------------------------------
// Node endpoint helpers
// ---------------------------------------------------------------------------

/** The Kubo RPC base URL for the local provider (trailing slash stripped). */
export function kuboRpcBase(config: IpfsSettings): string {
  const custom = config.nodeRpc?.trim().replace(/\/+$/, "");
  return custom && custom.length > 0 ? custom : DEFAULT_KUBO_RPC;
}

/**
 * True when the local provider points at the default same-machine daemon —
 * the only case where localhost gateway links make sense (a remote node's
 * gateway port/binding is unknowable from here).
 */
export function isDefaultNodeRpc(config: IpfsSettings): boolean {
  const base = kuboRpcBase(config);
  return base === DEFAULT_KUBO_RPC || base === "http://localhost:5001";
}

/**
 * True for a CIDv1 in lowercase base32 (what `cid-version=1` produces, e.g.
 * "bafybeih…"). CIDv0 ("Qm…", base58) and empty strings return false.
 */
export function isCidV1(cid: string): boolean {
  return /^b[a-z2-7]{20,}$/.test(cid);
}

/** https://<cid>.ipfs.<host> */
export function subdomainCidUrl(cid: string, host: string): string {
  return `https://${cid}.ipfs.${host}`;
}

/** https://<host>/ipfs/<cid> */
export function pathCidUrl(host: string, cid: string): string {
  return `https://${host}/ipfs/${cid}`;
}

/** https://<name>.ipns.<host> */
function subdomainIpnsUrl(name: string, host: string): string {
  return `https://${name}.ipns.${host}`;
}

/**
 * Best URL for a CID on a given host: subdomain form for CIDv1 (safe for
 * relative + root-absolute assets), path form otherwise.
 */
export function bestCidUrl(cid: string, host: string): string {
  return isCidV1(cid) ? subdomainCidUrl(cid, host) : pathCidUrl(host, cid);
}

/** Pinata's gateway URL for a CID (the user's dedicated host, or the shared one). */
export function pinataGatewayUrl(cid: string, customGateway?: string): string {
  const host = customGateway && customGateway.trim().length > 0
    ? customGateway.trim()
    : PINATA_DEFAULT_GATEWAY;
  return pathCidUrl(host, cid);
}

/**
 * The local node's own gateway URL, in subdomain form: origin-rooted, so
 * moss's root-absolute asset/link paths resolve (the path form serves unstyled
 * pages with dead navigation — verified live). `host` is read from the node
 * itself (kubo-gateway.ts); there is no default, because the port belongs to
 * the node's config and guessing it lands on whatever else holds that port.
 */
export function localGatewayCidUrl(cid: string, host: string): string {
  return `http://${cid}.ipfs.${host}`;
}

/**
 * The URL shown to the user (toast, result panel, deployment record).
 * - custom gateway host configured → path form on that host;
 * - local provider whose gateway we could actually locate → that gateway
 *   (instant and origin-rooted; a laptop node's content reaches public
 *   gateways only after propagation);
 * - otherwise → the public dweb.link gateway.
 */
export function siteDisplayUrl(
  cid: string,
  provider: ProviderId,
  config: IpfsSettings,
  localHost?: string,
): string {
  const custom = config.gateway?.trim();
  if (custom) return pathCidUrl(custom, cid);
  // Localhost links only make sense for the same-machine daemon; a custom
  // node endpoint (NAS/VPS) gets the public gateway.
  if (provider === "local" && isDefaultNodeRpc(config) && localHost) {
    return localGatewayCidUrl(cid, localHost);
  }
  return bestCidUrl(cid, PUBLIC_GATEWAY_DWEB);
}

/** What to hand moss as the published site's addresses (ADR-072). */
export interface AddressInput {
  cid: string;
  ipnsName?: string;
  provider: ProviderId;
  config: IpfsSettings;
  /** The local node's gateway host, when we could read it off the node. */
  localHost?: string;
  /** The custom domain, when one is configured (DNSLink). */
  domain?: string;
}

/**
 * Every way to reach this publish, as moss's own address rows.
 *
 * The plugin supplies the facts and the words; moss decides where they appear
 * — the first publish's window, the toast after it, the deploy tab always. A
 * CID and an IPNS name are strings to COPY (no `url`), so moss offers a copy
 * button; a gateway is a door to open.
 */
export function deployAddresses(input: AddressInput): DeployAddress[] {
  const { cid, ipnsName, provider, config, localHost, domain } = input;
  const useLocalHost = provider === "local" && isDefaultNodeRpc(config) && localHost;

  const addresses: DeployAddress[] = [
    {
      kind: "cid",
      label: "IPFS CID",
      value: cid,
      note: "Names these exact bytes. Every publish produces a new one.",
    },
  ];

  if (ipnsName) {
    addresses.push({
      kind: "ipns",
      label: "IPNS name",
      value: ipnsName,
      note: "Stays the same across publishes, and follows the newest one.",
    });
  }

  addresses.push(
    { kind: "gateway", label: "dweb.link", url: bestCidUrl(cid, PUBLIC_GATEWAY_DWEB) },
    // Serves HTML directly to browsers (no service-worker hop — dweb.link and
    // ipfs.io 302 navigations to inbrowser.link, whose worker can fail to
    // install). Path form works because uploads are relative-URL rewritten.
    { kind: "gateway", label: "filebase.io (direct)", url: pathCidUrl("ipfs.filebase.io", cid) },
    { kind: "gateway", label: "w3s.link", url: bestCidUrl(cid, PUBLIC_GATEWAY_W3S) },
  );

  if (provider === "pinata") {
    addresses.push({
      kind: "gateway",
      label: "Pinata gateway",
      url: pinataGatewayUrl(cid, config.gateway),
    });
  } else if (useLocalHost) {
    addresses.push({
      kind: "gateway",
      label: "Local gateway",
      url: localGatewayCidUrl(cid, localHost),
      note: "Served by the IPFS node on this computer.",
    });
  }

  if (ipnsName) {
    // IPNS names (k51…/base36 libp2p keys) are DNS-label-safe, so the
    // subdomain form works. For the local provider the LOCAL gateway is the
    // one that resolves the name immediately; a laptop-published IPNS record
    // reaches public gateways only after DHT propagation.
    addresses.push({
      kind: "gateway",
      label: "IPNS (stable)",
      url: useLocalHost
        ? `http://${ipnsName}.ipns.${localHost}`
        : subdomainIpnsUrl(ipnsName, PUBLIC_GATEWAY_DWEB),
    });
  }

  if (domain) {
    addresses.push({
      kind: "domain",
      label: "Custom domain",
      url: `https://${domain}`,
      note: "Resolves through DNSLink-aware gateways once the TXT record is live.",
    });
  }

  return addresses;
}
