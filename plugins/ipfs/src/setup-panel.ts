/**
 * Credential / readiness setup panels.
 *
 * Panels never make cross-origin requests themselves (Pinata lacks webview CORS;
 * a local Kubo RPC is Origin-locked) — they only collect input and emit an
 * event. The JWT is validated by the authenticated upload itself: a rejected
 * token is cleared (credentials.ts), so the next deploy shows a fresh prompt.
 * Render functions are pure (unit-tested); the prompt* functions do the
 * openBrowserWithHtml/onEvent choreography.
 */

import { closeBrowser } from "./utils";
import { escapeHtml, PANEL_STYLE, showPanel } from "./panel-common";

const PINATA_EVENT = "ipfs:pinata-credentials";
const LOCAL_EVENT = "ipfs:local-setup";

interface PinataPayload {
  jwt?: string;
  cancelled?: boolean;
}
interface LocalPayload {
  retry?: boolean;
  cancelled?: boolean;
}

// ---------------------------------------------------------------------------
// Pinata JWT panel
// ---------------------------------------------------------------------------

export function renderPinataSetupHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Connect Pinata</title><style>${PANEL_STYLE}</style></head>
<body><div class="card">
  <h1>Connect Pinata</h1>
  <p>Paste a Pinata JWT so moss can pin your site to IPFS. Create one at
     <code>app.pinata.cloud → API Keys → New Key</code> (needs Files write
     access — the default for new keys). It's stored locally, in this project only.</p>
  <textarea id="jwt" placeholder="eyJhbGci..." spellcheck="false"></textarea>
  <div class="status"></div>
  <div class="row">
    <button class="ghost" id="cancel">Cancel</button>
    <button class="primary" id="save" disabled>Save &amp; Deploy</button>
  </div>
  <div class="footer">Power users: set <code>MOSS_IPFS_PINATA_JWT</code> to skip this screen.</div>
</div>
<script>
  var jwt = document.getElementById('jwt');
  var save = document.getElementById('save');
  var cancel = document.getElementById('cancel');
  jwt.addEventListener('input', function () { save.disabled = jwt.value.trim().length === 0; });
  save.addEventListener('click', function () {
    var value = jwt.value.trim();
    if (!value) return;
    save.disabled = true;
    mossApi.emit('${PINATA_EVENT}', { jwt: value });
  });
  cancel.addEventListener('click', function () {
    mossApi.emit('${PINATA_EVENT}', { cancelled: true });
    mossApi.close();
  });
  jwt.focus();
</script>
</body></html>`;
}

/** Show the Pinata JWT panel; resolve the entered JWT, or null if cancelled. */
export async function promptPinataJwt(): Promise<string | null> {
  const payload = await showPanel<PinataPayload>(
    renderPinataSetupHtml(),
    PINATA_EVENT,
    "Connect Pinata to publish to IPFS...",
  );
  await closeBrowser();
  if (!payload || payload.cancelled || !payload.jwt) return null;
  return payload.jwt;
}

// ---------------------------------------------------------------------------
// Local Kubo daemon panel
// ---------------------------------------------------------------------------

export function renderLocalSetupHtml(opts: { reason?: string; installed?: boolean } = {}): string {
  const reason = opts.reason
    ? `<div class="status error">${escapeHtml(opts.reason)}</div>`
    : `<div class="status"></div>`;
  const guidance = opts.installed
    ? `<p>IPFS is installed, but moss couldn't start it automatically. Open your
       IPFS app (or start the daemon the way you usually do), then retry.</p>`
    : `<p>Publishing through your own node needs IPFS installed on this computer.
       The easiest way is <a href="https://docs.ipfs.tech/install/ipfs-desktop/">IPFS
       Desktop</a> — install it, open it once, then come back and retry.</p>
       <p>Prefer a hosted option instead? Switch the plugin's provider to Pinata in
       settings — no install needed.</p>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Set up IPFS</title><style>${PANEL_STYLE}</style></head>
<body><div class="card">
  <h1>Set up IPFS</h1>
  ${guidance}
  ${reason}
  <div class="row">
    <button class="ghost" id="cancel">Cancel</button>
    <button class="primary" id="retry">Retry connection</button>
  </div>
</div>
<script>
  document.getElementById('retry').addEventListener('click', function () {
    mossApi.emit('${LOCAL_EVENT}', { retry: true });
  });
  document.getElementById('cancel').addEventListener('click', function () {
    mossApi.emit('${LOCAL_EVENT}', { cancelled: true });
    mossApi.close();
  });
</script>
</body></html>`;
}

/**
 * Show the local-daemon guidance panel.
 * Resolves true when the user asks to retry (re-probe), false if cancelled.
 */
export async function promptLocalDaemon(
  opts: { reason?: string; installed?: boolean } = {},
): Promise<boolean> {
  const payload = await showPanel<LocalPayload>(
    renderLocalSetupHtml(opts),
    LOCAL_EVENT,
    "Waiting for a local IPFS node...",
  );
  if (!payload || payload.cancelled || !payload.retry) {
    await closeBrowser();
    return false;
  }
  // Keep the panel open across retries; the caller re-probes and may re-prompt.
  return true;
}
