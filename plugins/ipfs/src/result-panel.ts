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
/** Escape HTML-significant characters for safe interpolation. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shared panel stylesheet (compact, dark, matches the moss action panel). */
export const PANEL_STYLE = `
  :root { color-scheme: light dark; --bg:#0d1117; --surface:#161b22; --border:#30363d;
    --text:#e6edf3; --muted:#8b949e; --accent:#2f81f7; --accent-text:#fff;
    --danger:#f85149; --ok:#3fb950; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    background:var(--bg); color:var(--text); }
  .card { max-width:520px; margin:0 auto; background:var(--surface); border:1px solid var(--border);
    border-radius:12px; padding:24px; }
  h1 { font-size:18px; margin:0 0 8px; }
  p { color:var(--muted); margin:0 0 16px; }
  ol { color:var(--muted); margin:0 0 16px 18px; padding:0; }
  code { background:#0b0f14; border:1px solid var(--border); border-radius:5px; padding:1px 6px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:var(--text); }
  textarea, input { width:100%; background:#0b0f14; border:1px solid var(--border); border-radius:8px;
    color:var(--text); padding:10px 12px; font-family:ui-monospace,monospace; font-size:13px; resize:vertical; }
  textarea { min-height:90px; }
  .row { display:flex; gap:8px; margin-top:16px; }
  button { flex:1; border:none; border-radius:8px; padding:10px 14px; font-size:14px; font-weight:600;
    cursor:pointer; }
  .primary { background:var(--accent); color:var(--accent-text); }
  .primary:disabled { opacity:.5; cursor:not-allowed; }
  .ghost { background:transparent; color:var(--muted); border:1px solid var(--border); }
  .status { margin-top:12px; font-size:13px; min-height:18px; }
  .status.error { color:var(--danger); }
  .status.ok { color:var(--ok); }
  .footer { margin-top:16px; font-size:12px; color:var(--muted); }
  .links { list-style:none; margin:8px 0 0; padding:0; }
  .links li { display:flex; align-items:center; gap:8px; padding:6px 0; border-top:1px solid var(--border); }
  .links .lbl { width:120px; color:var(--muted); }
  .links a { color:var(--accent); text-decoration:none; word-break:break-all; flex:1; }
  .mono { font-family:ui-monospace,monospace; font-size:12px; word-break:break-all; }
`;
import type { GatewayLink } from "./gateways";

export interface ResultView {
  cid: string;
  ipnsName?: string;
  providerLabel: string;
  primaryUrl: string;
  links: GatewayLink[];
  /** Set when a custom domain is configured. */
  domain?: string;
  /** True when the only keeper is this machine's node (availability warning). */
  localOnly?: boolean;
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
    ? `<p>${escapeHtml(view.domain)} is set up via DNSLink, pointing at this publish.
       Publishing again gives you a new record to paste.</p>`
    : `<p>Tip: turn on IPNS for a URL that stays the same every time you publish.</p>`;

  const availability = view.localOnly
    ? `<p><strong>Heads up:</strong> this site is served by the IPFS node on this
       computer — it stays online only while the node is running. Turn on Co-Pin
       (with Pinata connected) or use the Pinata provider to keep it up around
       the clock.</p>`
    : "";
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
  ${availability}
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
