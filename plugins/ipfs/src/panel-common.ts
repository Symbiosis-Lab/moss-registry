/**
 * Shared panel plumbing: HTML escaping, the dark-mode CSS, and the
 * openBrowserWithHtml + onEvent choreography.
 */

import { openBrowserWithHtml, onEvent, startTask } from "@symbiosis-lab/moss-api";

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
 * Open an HTML panel and wait for the user to answer it.
 *
 * The wait is declared to moss with `task.awaiting()` (ADR-015): the host then
 * suspends its inactivity watchdog for as long as the hook sits there, because
 * the thing being waited on is a person. That is why there is no timeout and
 * no heartbeat here — the previous 10s fake progress pings existed only to
 * convince the watchdog someone was working, and the 300s cap they came with
 * closed panels out from under users who were still reading them.
 *
 * The listener is registered (and awaited) BEFORE the panel opens, so a submit
 * can never race listener registration.
 *
 * @param directive what the user has to do ("Paste your Pinata JWT")
 * @param venue     where they do it ("the Connect Pinata panel")
 */
export async function showPanel<T>(
  html: string,
  eventName: string,
  directive: string,
  venue: string,
): Promise<T | null> {
  const task = await startTask(directive, { hook: "deploy", trigger: "manual_one" });
  let unlisten: (() => void) | null = null;
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
    await task.awaiting(directive, venue);
    const payload = await eventArrived;
    await task.succeeded();
    return payload;
  } catch (error) {
    console.error(`[ipfs] panel error: ${error}`);
    await task.failed(String(error), true);
    return null;
  } finally {
    if (unlisten !== null) unlisten();
  }
}
