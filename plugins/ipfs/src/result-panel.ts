/**
 * Deploy-result summary panel.
 *
 * Shown once (on the first successful deploy) so it's a helpful onboarding
 * moment, not an interruption on every publish — the success toast is the
 * always-on feedback. renderResult is pure and unit-tested.
 *
 * Open-and-return: showResultPanel resolves as soon as the panel is displayed
 * (terrarium's pattern) — it does NOT block the deploy hook on user dismissal,
 * and needs no heartbeat because the hook finishes independently. The Done
 * button closes the panel from inside via mossApi.close().
 */

import { openBrowserWithHtml } from "@symbiosis-lab/moss-api";
import { escapeHtml, PANEL_STYLE } from "./panel-common";
import type { GatewayLink } from "./gateways";

export interface ResultView {
  cid: string;
  ipnsName?: string;
  providerLabel: string;
  primaryUrl: string;
  links: GatewayLink[];
  /** Set when a custom domain is configured. */
  domain?: string;
  /** Whether the domain will auto-update (IPNS) or is pinned to a CID. */
  domainStable?: boolean;
}

function linkRow(link: GatewayLink): string {
  const url = escapeHtml(link.url);
  return `<li><span class="lbl">${escapeHtml(link.label)}</span>` +
    `<a href="${url}">${url}</a>` +
    `<button class="ghost copy" data-copy="${url}">Copy</button></li>`;
}

/** Pure renderer for the result panel HTML. */
export function renderResult(view: ResultView): string {
  const ipnsRow = view.ipnsName
    ? `<li><span class="lbl">IPNS</span><span class="mono">${escapeHtml(view.ipnsName)}</span>` +
      `<button class="ghost copy" data-copy="${escapeHtml(view.ipnsName)}">Copy</button></li>`
    : "";
  const dnslink = view.domain
    ? `<p>${escapeHtml(view.domain)} is set up via DNSLink — ${
        view.domainStable
          ? "future deploys update automatically (IPNS)."
          : "it points at this CID; re-deploy with IPNS to avoid editing DNS each time."
      }</p>`
    : `<p>Tip: enable IPNS or a custom domain for a URL that doesn't change every deploy.</p>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your site is on IPFS</title><style>${PANEL_STYLE}</style></head>
<body><div class="card">
  <h1>Your site is on IPFS</h1>
  <p>Pinned via ${escapeHtml(view.providerLabel)}. Share any gateway link below.</p>
  <ul class="links">
    <li><span class="lbl">CID</span><span class="mono">${escapeHtml(view.cid)}</span>
      <button class="ghost copy" data-copy="${escapeHtml(view.cid)}">Copy</button></li>
    ${ipnsRow}
    ${view.links.map(linkRow).join("\n    ")}
  </ul>
  ${dnslink}
  <div class="row">
    <button class="primary" id="done">Done</button>
  </div>
</div>
<script>
  document.querySelectorAll('.copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-copy') || '';
      if (navigator.clipboard) navigator.clipboard.writeText(v);
      b.textContent = 'Copied';
      setTimeout(function () { b.textContent = 'Copy'; }, 1200);
    });
  });
  document.getElementById('done').addEventListener('click', function () {
    mossApi.close();
  });
</script>
</body></html>`;
}

/** Open the result panel; resolves once displayed (does not wait for dismissal). */
export async function showResultPanel(view: ResultView): Promise<void> {
  try {
    await openBrowserWithHtml(renderResult(view));
  } catch (e) {
    // Non-fatal — the toast already delivered the result.
    console.warn(`[ipfs] result panel failed to open: ${e}`);
  }
}
