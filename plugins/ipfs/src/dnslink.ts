/**
 * DNSLink record generation for custom domains.
 *
 * Mirrors github/src/main.ts:generateDnsTarget. moss's DNS machinery consumes
 * the returned DnsTarget (writing the records and re-invoking configure_domain),
 * exactly as it does for the GitHub deployer.
 *
 * The target is the deploy's CID, not its IPNS name. An IPNS record published
 * from this plugin lives 48 hours and is only ever republished by the next
 * deploy, so a domain pointed at /ipns/ goes dark two days after a publish for
 * anyone who publishes less often than that — silently, which is the worst way
 * for a custom domain to fail. A CID target is always resolvable; the cost is
 * that publishing again means updating the TXT record, which moss surfaces.
 * When there is a republish story (a node that reannounces the record), this
 * decision is worth revisiting.
 */

import { PUBLIC_GATEWAY_DWEB } from "./constants";
import type { DnsTarget, DnsRecord } from "./types";

export interface DnsLinkInput {
  /** The deploy's root CID. */
  cid: string;
}

/** Build the `dnslink=` TXT value. */
export function dnslinkValue({ cid }: DnsLinkInput): string {
  return `dnslink=/ipfs/${cid}`;
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
