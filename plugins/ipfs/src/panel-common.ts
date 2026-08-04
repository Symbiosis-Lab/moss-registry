/**
 * Shared panel plumbing: HTML escaping, the dark-mode CSS, and the
 * openBrowserWithHtml + onEvent + heartbeat choreography (mirrors
 * github/src/repo-setup.ts:showBrowserWithProgress).
 */

import { openBrowserWithHtml, onEvent } from "@symbiosis-lab/moss-api";
import { reportProgress } from "./utils";
import { HEARTBEAT_MS } from "./constants";

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

/**
 * Open an HTML panel and wait for a single custom event (or timeout).
 * Emits a progress heartbeat so the panel doesn't hit the stale timeout.
 * Returns the event payload, or null on timeout/error.
 *
 * The listener is registered (and awaited) BEFORE the panel opens, so a
 * submit can never race listener registration, and `unlisten` is always
 * assigned by the time cleanup runs — no leaked listeners on the timeout path.
 */
export async function showPanel<T>(
  html: string,
  eventName: string,
  progressMessage: string,
  timeoutMs = 300_000,
): Promise<T | null> {
  const heartbeat = setInterval(() => {
    void reportProgress("setup", 0, 10, progressMessage);
  }, HEARTBEAT_MS);

  let unlisten: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    let resolveEvent: (payload: T) => void;
    const eventArrived = new Promise<T>((resolve) => {
      resolveEvent = resolve;
    });
    unlisten = await onEvent<T>(eventName, (payload) => {
      resolveEvent(payload);
      return payload;
    });

    await openBrowserWithHtml(html);
    return await Promise.race([
      eventArrived,
      new Promise<T | null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch (error) {
    console.error(`[ipfs] panel error: ${error}`);
    return null;
  } finally {
    clearInterval(heartbeat);
    if (timer !== null) clearTimeout(timer);
    if (unlisten !== null) unlisten();
  }
}
