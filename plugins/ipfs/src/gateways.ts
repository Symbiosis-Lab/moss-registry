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
 * The public-facing gateway host for any address that has to work for someone
 * who isn't running this plugin: the configured `gateway` setting (including a
 * Pinata dedicated gateway, which is just a hostname here), else dweb.link.
 */
function publicGatewayHost(config: IpfsSettings): string {
  const custom = config.gateway?.trim();
  return custom && custom.length > 0 ? custom : PUBLIC_GATEWAY_DWEB;
}

/**
 * The CID through the public door: path form on a configured gateway (not
 * every custom host supports subdomain isolation), else the best form on
 * dweb.link.
 */
function publicDoorCidUrl(cid: string, config: IpfsSettings): string {
  const custom = config.gateway?.trim();
  return custom && custom.length > 0 ? pathCidUrl(custom, cid) : bestCidUrl(cid, PUBLIC_GATEWAY_DWEB);
}

/**
 * The IPNS name through the public door, in subdomain form — IPNS names
 * (k51…/base36 libp2p keys) are DNS-label-safe, so this works on any host.
 */
function publicDoorIpnsUrl(name: string, config: IpfsSettings): string {
  return subdomainIpnsUrl(name, publicGatewayHost(config));
}

/**
 * The site's standing address — what you hand out, and what the View button
 * and toast use. A local node's own gateway is instant but private to this
 * machine, so it never becomes the standing address; it exists only as the
 * "Local gateway" row `deployAddresses` emits.
 */
export function siteDisplayUrl(
  cid: string,
  config: IpfsSettings,
  opts: { ipnsName?: string; domain?: string } = {},
): string {
  if (opts.domain) return `https://${opts.domain}`;
  if (opts.ipnsName) return publicDoorIpnsUrl(opts.ipnsName, config);
  return publicDoorCidUrl(cid, config);
}

/**
 * The IPNS record's lifecycle, in one line. Shared by the IPNS row's note and
 * the domain-setup message (main.ts) so the two surfaces state the same fact
 * and can't drift apart.
 */
export const IPNS_RECORD_NOTE =
  "The record behind this name expires 48 hours after your last publish.";

/**
 * The publish, as the addresses moss renders — one row per fact: the address
 * that stays (a custom domain, or the IPNS name), the version you're looking
 * at (the CID), and the provider's own door onto them. moss owns the rows,
 * the copy buttons and the modal; this decides only what exists and what each
 * one is called.
 */
export function deployAddresses(opts: {
  cid: string;
  ipnsName?: string;
  provider: ProviderId;
  config: IpfsSettings;
  localHost?: string;
  domain?: string;
  localOnly: boolean;
}): DeployAddress[] {
  const { cid, ipnsName, provider, config, localHost, domain, localOnly } = opts;
  const addresses: DeployAddress[] = [];

  if (domain) {
    addresses.push({ kind: "domain", label: "Custom domain", url: `https://${domain}` });
  }

  if (ipnsName) {
    addresses.push({
      kind: "ipns",
      label: "IPNS name",
      value: ipnsName,
      url: publicDoorIpnsUrl(ipnsName, config),
      note: IPNS_RECORD_NOTE,
    });
  }

  addresses.push({
    kind: "cid",
    label: "CID",
    value: cid,
    url: publicDoorCidUrl(cid, config),
    note: "Names exactly this version",
  });

  // The provider's own door — the only row that can vanish (a remote/unknown
  // local node offers no local link at all, rather than one that 404s).
  const useLocalHost = provider === "local" && isDefaultNodeRpc(config) && !!localHost;
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
      url: localGatewayCidUrl(cid, localHost as string),
      // The one thing a reader cannot see from the row itself: this door is
      // open only while the node on this computer is.
      ...(localOnly
        ? { note: "Served by the IPFS node on this computer — reachable only while it runs." }
        : {}),
    });
  }

  return addresses;
}
