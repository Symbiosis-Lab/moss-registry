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
const CONSENT_EVENT = "ipfs:daemon-consent";

interface PinataPayload {
  jwt?: string;
  cancelled?: boolean;
}
interface LocalPayload {
  retry?: boolean;
  changePort?: boolean;
  cancelled?: boolean;
}
interface ConsentPayload {
  start?: boolean;
  cancelled?: boolean;
}

/** What the user chose in the local-node panel. */
export type LocalSetupChoice = "retry" | "change-port" | "cancel";

/** An offer to move the node's gateway off a port something else holds. */
export interface GatewayPortOffer {
  taken: number;
  suggested: number;
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
     access — the default for new keys). moss keeps it on this computer, in the
     same place as your other plugin sign-ins — it is shared by every project
     you publish from, and is sent only to Pinata.</p>
  <textarea id="jwt" placeholder="eyJhbGci..." spellcheck="false"></textarea>
  <div class="status"></div>
  <div class="row">
    <button class="ghost" id="cancel">Cancel</button>
    <button class="primary" id="save" disabled>Save &amp; Deploy</button>
  </div>
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
    "Paste your Pinata API token",
    "the Connect Pinata panel",
  );
  await closeBrowser();
  if (!payload || payload.cancelled || !payload.jwt) return null;
  return payload.jwt;
}

// ---------------------------------------------------------------------------
// Local Kubo daemon panel
// ---------------------------------------------------------------------------

export function renderLocalSetupHtml(
  opts: { reason?: string; installed?: boolean; portOffer?: GatewayPortOffer } = {},
): string {
  const reason = opts.reason
    ? `<div class="status error">${escapeHtml(opts.reason)}</div>`
    : `<div class="status"></div>`;
  const guidance = opts.portOffer
    ? `<p>Your IPFS node's gateway is set to port ${opts.portOffer.taken}, which another
       program on this computer is already using. moss can move the gateway to port
       ${opts.portOffer.suggested} instead — this edits your IPFS node's own configuration,
       which is why it asks first. Nothing else about your node changes.</p>`
    : opts.installed
      ? `<p>IPFS is installed, but moss couldn't start it automatically. Open your
         IPFS app (or start the daemon the way you usually do), then retry.</p>`
      : `<p>Publishing through your own node needs IPFS installed on this computer.
         The easiest way is <a href="https://docs.ipfs.tech/install/ipfs-desktop/">IPFS
         Desktop</a> — install it, open it once, then come back and retry.</p>
         <p>Prefer a hosted option instead? Switch the plugin's provider to Pinata in
         settings — no install needed.</p>`;
  const primary = opts.portOffer
    ? `<button class="primary" id="changePort">Use port ${opts.portOffer.suggested}</button>`
    : `<button class="primary" id="retry">Retry connection</button>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Set up IPFS</title><style>${PANEL_STYLE}</style></head>
<body><div class="card">
  <h1>Set up IPFS</h1>
  ${guidance}
  ${reason}
  <div class="row">
    <button class="ghost" id="cancel">Cancel</button>
    ${primary}
  </div>
</div>
<script>
  var change = document.getElementById('changePort');
  if (change) change.addEventListener('click', function () {
    mossApi.emit('${LOCAL_EVENT}', { changePort: true });
  });
  var retry = document.getElementById('retry');
  if (retry) retry.addEventListener('click', function () {
    mossApi.emit('${LOCAL_EVENT}', { retry: true });
  });
  document.getElementById('cancel').addEventListener('click', function () {
    mossApi.emit('${LOCAL_EVENT}', { cancelled: true });
    mossApi.close();
  });
</script>
</body></html>`;
}

/** Show the local-daemon panel and report what the user chose. */
export async function promptLocalDaemon(
  opts: { reason?: string; installed?: boolean; portOffer?: GatewayPortOffer } = {},
): Promise<LocalSetupChoice> {
  const payload = await showPanel<LocalPayload>(
    renderLocalSetupHtml(opts),
    LOCAL_EVENT,
    "Set up an IPFS node",
    "the Set up IPFS panel",
  );
  if (payload?.changePort) return "change-port";
  // Keep the panel open across retries; the caller re-probes and may re-prompt.
  if (payload?.retry) return "retry";
  await closeBrowser();
  return "cancel";
}

// ---------------------------------------------------------------------------
// Daemon consent panel
// ---------------------------------------------------------------------------

/**
 * Asked once per project, before moss ever starts a daemon. Starting a
 * long-lived background process on someone's computer is theirs to agree to,
 * and the three facts below are the ones they cannot discover afterwards: it
 * outlives moss, it does not survive a reboot, and stopping it is manual.
 */
export function renderDaemonConsentHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Start your IPFS node</title><style>${PANEL_STYLE}</style></head>
<body><div class="card">
  <h1>Start your IPFS node?</h1>
  <p>To publish through your own node, moss starts IPFS on this computer.</p>
  <ol>
    <li>It keeps running after you quit moss — that is what keeps your site reachable.</li>
    <li>It does not start again by itself after you restart your computer. Until you
        start it again, your site is served only by whoever else has a copy.</li>
    <li>To stop it: quit IPFS Desktop if you use it, or run <code>ipfs shutdown</code>
        in Terminal.</li>
  </ol>
  <p>Prefer not to run a node? Switch the plugin's provider to Pinata in settings.</p>
  <div class="row">
    <button class="ghost" id="cancel">Not now</button>
    <button class="primary" id="start">Start IPFS</button>
  </div>
</div>
<script>
  document.getElementById('start').addEventListener('click', function () {
    mossApi.emit('${CONSENT_EVENT}', { start: true });
  });
  document.getElementById('cancel').addEventListener('click', function () {
    mossApi.emit('${CONSENT_EVENT}', { cancelled: true });
    mossApi.close();
  });
</script>
</body></html>`;
}

/** Ask for consent to start a daemon. True only on an explicit yes. */
export async function promptDaemonConsent(): Promise<boolean> {
  const payload = await showPanel<ConsentPayload>(
    renderDaemonConsentHtml(),
    CONSENT_EVENT,
    "Start an IPFS node on this computer",
    "the Start your IPFS node panel",
  );
  if (payload?.start) return true;
  await closeBrowser();
  return false;
}
