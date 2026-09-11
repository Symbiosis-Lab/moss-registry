/**
 * DNSLink record generation for custom domains.
 *
 * Mirrors github/src/main.ts:generateDnsTarget. moss's DNS machinery consumes
 * the returned DnsTarget (writing the records and re-invoking configure_domain),
 * exactly as it does for the GitHub deployer.
 *
 * We prefer an IPNS target so the domain survives re-deploys without a DNS edit;
 * we fall back to the raw CID when IPNS is unavailable.
 */

import { PUBLIC_GATEWAY_DWEB } from "./constants";
import type { DnsTarget, DnsRecord } from "./types";

export interface DnsLinkInput {
  /** Stable IPNS name (preferred). */
  ipnsName?: string;
  /** Fallback CID when IPNS is off/unavailable. */
  cid: string;
}

/** Build the `dnslink=` TXT value, preferring IPNS. */
export function dnslinkValue({ ipnsName, cid }: DnsLinkInput): string {
  return ipnsName ? `dnslink=/ipns/${ipnsName}` : `dnslink=/ipfs/${cid}`;
}

/**
 * Generate DNS records for a DNSLink custom domain:
 *   - TXT `_dnslink.<domain>`  → the DNSLink pointer (the load-bearing record)
 *   - CNAME `<domain>`         → a DNSLink-resolving gateway (dweb.link)
 *
 * `name` values are relative labels; moss appends the zone (so "_dnslink"
 * becomes `_dnslink.<domain>` and "@" is the apex).
 */
export function generateDnsTarget(input: DnsLinkInput): DnsTarget {
  const records: DnsRecord[] = [
    { record_type: "TXT", name: "_dnslink", value: dnslinkValue(input) },
    { record_type: "CNAME", name: "@", value: PUBLIC_GATEWAY_DWEB },
  ];
  return { records };
}
