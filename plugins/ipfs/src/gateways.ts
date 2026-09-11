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
  KUBO_SUBDOMAIN_HOST,
  DEFAULT_KUBO_RPC,
} from "./constants";
import type { IpfsPluginConfig, ProviderId } from "./types";

// ---------------------------------------------------------------------------
// Node endpoint helpers
// ---------------------------------------------------------------------------

/** The Kubo RPC base URL for the local provider (trailing slash stripped). */
export function kuboRpcBase(config: IpfsPluginConfig): string {
  const custom = config.nodeRpc?.trim().replace(/\/+$/, "");
  return custom && custom.length > 0 ? custom : DEFAULT_KUBO_RPC;
}

/**
 * True when the local provider points at the default same-machine daemon —
 * the only case where localhost gateway links make sense (a remote node's
 * gateway port/binding is unknowable from here).
 */
export function isDefaultNodeRpc(config: IpfsPluginConfig): boolean {
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

/**
 * The primary, shareable "View site" URL.
 *
 * A user-configured gateway host gets the PATH form: most custom gateways
 * (Pinata public + dedicated included) are path-style only, and the manifest's
 * documented example is gateway.pinata.cloud — subdomain form there would be
 * an NXDOMAIN. Only the known subdomain-capable default (dweb.link) uses the
 * origin-isolated subdomain form.
 */
export function primaryGatewayUrl(cid: string, config: IpfsPluginConfig): string {
  const custom = config.gateway?.trim();
  if (custom) return pathCidUrl(custom, cid);
  return bestCidUrl(cid, PUBLIC_GATEWAY_DWEB);
}

/** Provider-native gateway URL (Pinata gateway, or local Kubo gateway). */
export function providerGatewayUrl(
  provider: ProviderId,
  cid: string,
  customGateway?: string,
): string {
  if (provider === "local") {
    // Subdomain form: origin-rooted, so moss's root-absolute asset/link paths
    // resolve (the path form breaks styling and navigation).
    return `http://${cid}.ipfs.${KUBO_SUBDOMAIN_HOST}`;
  }
  const host = customGateway && customGateway.trim().length > 0
    ? customGateway.trim()
    : PINATA_DEFAULT_GATEWAY;
  return pathCidUrl(host, cid);
}

/**
 * The URL shown to the user (toast, result panel, deployment record).
 * - custom gateway host configured → path form on that host;
 * - local provider → the local subdomain gateway (instant and origin-rooted;
 *   a laptop node's content reaches public gateways only after propagation);
 * - otherwise → the public dweb.link gateway.
 */
export function siteDisplayUrl(
  cid: string,
  provider: ProviderId,
  config: IpfsPluginConfig,
): string {
  const custom = config.gateway?.trim();
  if (custom) return pathCidUrl(custom, cid);
  // Localhost links only make sense for the same-machine daemon; a custom
  // node endpoint (NAS/VPS) gets the public gateway.
  if (provider === "local" && isDefaultNodeRpc(config)) {
    return providerGatewayUrl("local", cid);
  }
  return bestCidUrl(cid, PUBLIC_GATEWAY_DWEB);
}

export interface GatewayLink {
  label: string;
  url: string;
}

/**
 * All gateway/IPNS links to surface in the result panel, most-shareable first.
 * Provider-specific and local links are appended where relevant.
 */
export function gatewayLinks(
  cid: string,
  ipnsName: string | undefined,
  provider: ProviderId,
  config: IpfsPluginConfig,
): GatewayLink[] {
  const links: GatewayLink[] = [
    { label: "dweb.link", url: bestCidUrl(cid, PUBLIC_GATEWAY_DWEB) },
    // Serves HTML directly to browsers (no service-worker hop — dweb.link and
    // ipfs.io 302 navigations to inbrowser.link, whose worker can fail to
    // install). Path form works because uploads are relative-URL rewritten.
    { label: "filebase.io (direct)", url: pathCidUrl("ipfs.filebase.io", cid) },
    { label: "w3s.link", url: bestCidUrl(cid, PUBLIC_GATEWAY_W3S) },
  ];
  if (provider === "pinata") {
    links.push({
      label: "Pinata gateway",
      url: providerGatewayUrl("pinata", cid, config.gateway),
    });
  } else if (isDefaultNodeRpc(config)) {
    links.push({ label: "Local gateway", url: providerGatewayUrl("local", cid) });
  }
  if (ipnsName) {
    // IPNS names (k51…/base36 libp2p keys) are DNS-label-safe, so the
    // subdomain form works. For the local provider the LOCAL gateway is the
    // one that resolves the name immediately; a laptop-published IPNS record
    // reaches public gateways only after DHT propagation.
    links.push({
      label: "IPNS (stable)",
      url:
        provider === "local" && isDefaultNodeRpc(config)
          ? `http://${ipnsName}.ipns.${KUBO_SUBDOMAIN_HOST}`
          : subdomainIpnsUrl(ipnsName, PUBLIC_GATEWAY_DWEB),
    });
  }
  return links;
}
