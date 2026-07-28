/**
 * Pure gallery renderer — turns the typed `Window[]` catalog into a single,
 * self-contained HTML document for the action-panel webview.
 *
 * Pure: no Tauri, no DOM, no moss-api at module scope. It returns a string. The
 * embedded `<script>` is the only thing that touches Tauri, and it runs inside
 * the action-panel webview (which has `window.__TAURI__.core.invoke`).
 *
 * The driver, per the verified moss contract:
 *   - driver "sim"    → invoke("dev_simulate_panel_task", { args: payload })
 *   - driver "plugin" → invoke("report_plugin_task_lifecycle_command", {
 *                         pluginName, hook, trigger, taskId, lifecycle })
 *     first with lifecycle {type:"started", ...} (returns a task id), then again
 *     with that taskId and the terminal lifecycle. The lifecycle enum is serde
 *     `tag="type"` + snake_case, so the wire form is {type:"started"|"succeeded"
 *     |"failed"|"awaiting", ...}. Invoke arg keys are Tauri v2 camelCase
 *     (pluginName, taskId), confirmed against bindings.ts.
 *
 * Every invoke is wrapped in try/catch: in a release build where
 * `dev_simulate_panel_task` is absent (it is cfg(debug_assertions)), the sim
 * rows degrade to a logged no-op with a visible row state instead of throwing.
 */

import type { Window } from "./windows";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Serialise the catalog for embedding inside a `<script>` element. Beyond
 * normal JSON we neutralise the `<` / `>` / `&` HTML-significant characters
 * (so a `</script>` inside a string can't terminate the element early) and the
 * U+2028 / U+2029 line/paragraph separators (valid JSON, but illegal raw in a
 * script body).
 */
function embedJson(value: unknown): string {
  const LS = String.fromCharCode(0x2028); // line separator
  const PS = String.fromCharCode(0x2029); // paragraph separator
  const map: Record<string, string> = {
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    [LS]: "\\u2028",
    [PS]: "\\u2029",
  };
  return JSON.stringify(value).replace(
    new RegExp("[<>&" + LS + PS + "]", "g"),
    (ch) => map[ch] ?? ch,
  );
}

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: #1d2421;
    background: #fbfcfb;
    /* Top inset clears the macOS traffic lights / moss titlebar
       (TITLEBAR_HEIGHT = 48px) so the heading is not overlapped. */
    padding: 48px 18px 28px;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e7ece9; background: #14181a; }
  }
  header { margin: 2px 0 16px; }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 2px; }
  .sub { font-size: 12px; opacity: 0.62; margin: 0; }
  .group { font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
           text-transform: uppercase; opacity: 0.55; margin: 18px 0 6px; }
  .group:first-of-type { margin-top: 8px; }
  .row {
    display: flex; flex-direction: column; gap: 2px; width: 100%;
    text-align: left; cursor: pointer;
    border: 1px solid rgba(127,150,142,0.28);
    border-radius: 8px; background: rgba(127,177,166,0.06);
    color: inherit; font: inherit;
    padding: 9px 11px; margin-bottom: 7px;
    transition: background 0.12s ease, border-color 0.12s ease;
  }
  .row:hover { background: rgba(127,177,166,0.16); border-color: rgba(79,131,120,0.5); }
  .row:active { background: rgba(127,177,166,0.26); }
  .row .label { font-weight: 540; }
  .row .surface { font-size: 11.5px; opacity: 0.6; }
  .row[data-state="firing"] { border-color: #4f8378; }
  .row[data-state="error"] {
    border-color: #c0573f; background: rgba(192,87,63,0.1);
  }
  .row .state { font-size: 11px; opacity: 0.8; margin-top: 2px; display: none; }
  .row[data-state] .state { display: block; }
  .row[data-state="error"] .state { color: #c0573f; opacity: 1; }
  footer { margin-top: 20px; font-size: 11px; opacity: 0.5; line-height: 1.45; }
`.trim();

/**
 * Render the gallery as a complete HTML document string. Pure.
 */
export function renderGallery(windows: Window[]): string {
  // Preserve catalog order within groups, but emit a heading the first time a
  // group appears.
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const w of windows) {
    if (!seen.has(w.group)) {
      seen.add(w.group);
      rows.push(`<div class="group">${escapeHtml(w.group)}</div>`);
    }
    rows.push(
      `<button class="row" type="button" data-window-id="${escapeHtml(w.id)}">` +
        `<span class="label">${escapeHtml(w.label)}</span>` +
        `<span class="surface">${escapeHtml(w.surface)}</span>` +
        `<span class="state" aria-live="polite"></span>` +
        `</button>`,
    );
  }

  const catalog = embedJson(windows);

  // The driver script. Kept as a vanilla-JS template string (it runs in the
  // webview, not under the bundler). Arg casing + lifecycle tagging are the
  // source-verified forms.
  const driver = `
(function () {
  "use strict";
  var WINDOWS = ${catalog};
  var byId = {};
  for (var i = 0; i < WINDOWS.length; i++) byId[WINDOWS[i].id] = WINDOWS[i];

  function invoke() {
    var t = window.__TAURI__;
    if (!t || !t.core || typeof t.core.invoke !== "function") {
      throw new Error("window.__TAURI__.core.invoke unavailable (open in moss, not a browser)");
    }
    return t.core.invoke.apply(t.core, arguments);
  }

  function setState(el, state, msg) {
    if (!el) return;
    if (state) el.setAttribute("data-state", state);
    else el.removeAttribute("data-state");
    var s = el.querySelector(".state");
    if (s) s.textContent = msg || "";
  }

  // Map a catalog terminal ({kind, ...}) onto the snake_case internally-tagged
  // PluginTaskLifecycle wire form ({type, ...}).
  function terminalLifecycle(term) {
    if (term.kind === "succeeded") {
      return { type: "succeeded", receipt: term.receipt, advisories: term.advisories || [], amount: term.amount != null ? term.amount : null };
    }
    if (term.kind === "failed") {
      return { type: "failed", error: term.error, recoverable: !!term.recoverable, advisories: term.advisories || [] };
    }
    if (term.kind === "awaiting") {
      return { type: "awaiting", directive: term.directive, escape: term.escape };
    }
    throw new Error("unknown terminal kind: " + (term && term.kind));
  }

  async function fireSim(w, el) {
    setState(el, "firing", "firing sim...");
    try {
      var id = await invoke("dev_simulate_panel_task", { args: w.payload });
      setState(el, "firing", "task " + id + " - watch " + w.surface);
    } catch (e) {
      console.error("[terrarium] sim '" + w.id + "' failed:", e);
      setState(el, "error", "no-op (needs a dev build with dev_simulate): " + e);
    }
  }

  async function firePlugin(w, el) {
    var p = w.payload;
    setState(el, "firing", "starting job...");
    try {
      var taskId = await invoke("report_plugin_task_lifecycle_command", {
        pluginName: "terrarium",
        hook: p.hook,
        trigger: p.trigger,
        taskId: null,
        lifecycle: { type: "started", label: p.label, has_progress: false, cancellable: false }
      });
      await invoke("report_plugin_task_lifecycle_command", {
        pluginName: "terrarium",
        hook: p.hook,
        trigger: p.trigger,
        taskId: taskId,
        lifecycle: terminalLifecycle(p.terminal)
      });
      setState(el, "firing", "job " + taskId + " - watch " + w.surface);
    } catch (e) {
      console.error("[terrarium] plugin '" + w.id + "' failed:", e);
      setState(el, "error", "failed: " + e);
    }
  }

  async function fireModal(w, el) {
    setState(el, "firing", "opening modal…");
    try {
      var ev = window.__TAURI__ && window.__TAURI__.event;
      if (!ev || typeof ev.emitTo !== "function") {
        throw new Error("__TAURI__.event.emitTo unavailable (needs withGlobalTauri:true, dev build)");
      }
      await ev.emitTo("main", "moss-dev:open-modal", {
        modalId: w.payload.modalId,
        opts: w.payload.opts,
      });
      setState(el, null, "");
    } catch (e) {
      console.error("[terrarium] modal '" + w.id + "' failed:", e);
      setState(el, "error", "failed: " + e);
    }
  }

  function fire(id, el) {
    var w = byId[id];
    if (!w) { console.error("[terrarium] no window '" + id + "'"); return; }
    if (w.driver === "sim") return fireSim(w, el);
    if (w.driver === "plugin") return firePlugin(w, el);
    if (w.driver === "modal") return fireModal(w, el);
    console.error("[terrarium] unknown driver on '" + id + "':", w.driver);
  }

  document.addEventListener("click", function (ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest("[data-window-id]") : null;
    if (!el) return;
    fire(el.getAttribute("data-window-id"), el);
  });
})();
`.trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>terrarium</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>terrarium</h1>
  <p class="sub">advisory-window review harness. Click a row to fire the real window in moss.</p>
</header>
${rows.join("\n")}
<footer>
  Plugin rows go through the real report_plugin_task_lifecycle seam (moss holds the severity gavel).
  Sim rows use dev_simulate_panel_task (dev builds only). A clean Workspace success is intentionally silent.
</footer>
<script>${driver}</script>
</body>
</html>`;
}
