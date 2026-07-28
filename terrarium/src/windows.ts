/**
 * terrarium window catalog — the advisory-window review harness, as typed data.
 *
 * Each entry is one window the gallery can fire in the live app. The catalog is
 * the re-homed, typed form of the old console script
 * `advisory-review/advisory-windows.js`; the `sim` payloads are byte-for-byte
 * the same `dev_simulate_panel_task` args, and the `plugin` payloads drive the
 * real `report_plugin_task_lifecycle_command` seam that plugin authors use.
 *
 * Types mirror the moss contract (`frontend/app/bindings.ts`), verified against
 * source:
 *   - Scope     = File | Config | Environment | Remote | Account
 *   - Severity  = ShippedDegraded | NeedsAction | Blocking
 *   - Action    = "None" | {Command:{run,label}} | {InApp:{op,args,label}}
 *                 | {Link:{href,label}}
 *   - DevSimulateArgs = { window_id, scope: TaskScope, tone: TaskTone, kind, title, steps }
 *   - SimulatedStep (serde internally tagged on `kind`):
 *       { kind:"progress",  fraction, message, delay_ms }
 *       { kind:"awaiting",  directive, escape, delay_ms }
 *       { kind:"succeeded", receipt, advisories? }
 *       { kind:"failed",    error, recoverable, advisory? }   ← singular `advisory`
 *       { kind:"cancelled" }
 *   - PluginTaskLifecycle (serde tag="type", snake_case): the gallery's plugin
 *     driver always sends `{type:"started", ...}` first, then one terminal of
 *     `{type:"succeeded", receipt, advisories?}` / `{type:"failed", error,
 *     recoverable, advisories?}` / `{type:"awaiting", directive, escape}`.
 *     We model the terminal here with the `kind` discriminant the gallery maps
 *     onto the `type`-tagged wire form, so this catalog stays a pure data table.
 */

// ── contract enums (string-literal mirrors) ────────────────────────────────
export type Scope = "File" | "Config" | "Environment" | "Remote" | "Account";
export type Severity = "ShippedDegraded" | "NeedsAction" | "Blocking";
export type TaskScope = "action_panel" | "preview" | "workspace";
export type TaskTone = "ambient" | "inline" | "narrated" | "awaiting";

export type Action =
  | "None"
  | { Command: { run: string; label: string } }
  | { InApp: { op: string; args: Record<string, unknown>; label: string } }
  | { Link: { href: string; label: string } };

export interface Advisory {
  scope: Scope;
  severity: Severity;
  item: string | null;
  what: string;
  action: Action;
}

// ── sim driver payload (dev_simulate_panel_task) ────────────────────────────
export type SimulatedStep =
  | { kind: "progress"; fraction: number | null; message: string; delay_ms: number | null }
  | { kind: "awaiting"; directive: string; escape: string; delay_ms: number | null }
  | { kind: "succeeded"; receipt: string | null; advisories?: Advisory[] }
  | { kind: "failed"; error: string; recoverable: boolean; advisory?: Advisory | null }
  | { kind: "cancelled" };

export interface SimPayload {
  window_id: string;
  scope: TaskScope;
  tone: TaskTone;
  kind: string;
  title: string;
  steps: SimulatedStep[];
}

// ── plugin driver payload (report_plugin_task_lifecycle_command) ────────────
export type PluginTerminal =
  | { kind: "succeeded"; receipt: string | null; advisories?: Advisory[]; amount?: number | null }
  | { kind: "failed"; error: string; recoverable: boolean; advisories?: Advisory[] }
  | { kind: "awaiting"; directive: string; escape: string };

export interface PluginPayload {
  /** A `PluginHook` value, e.g. "syndicate" | "deploy" | "import". */
  hook: string;
  /** A `TriggerContext` value, e.g. "background" | "settings_manual". */
  trigger: string;
  /** The label moss shows while the task runs (the `Started.label`). */
  label: string;
  terminal: PluginTerminal;
}

// ── modal driver payload (opens a modal overlay in the main shell webview) ─
export interface ModalPayload {
  /** "first-publish" | "reverify" */
  modalId: string;
  opts: Record<string, unknown>;
}

export interface Window {
  id: string;
  label: string;
  group: "Deploy" | "Domain" | "Plugin" | "Build" | "Modal";
  surface: string;
  driver: "plugin" | "sim" | "modal";
  payload: PluginPayload | SimPayload | ModalPayload;
}

// ── small builders (mirror advisory-windows.js helpers) ─────────────────────
const prog = (
  message: string,
  fraction: number | null = null,
  delay_ms = 1200,
): SimulatedStep => ({ kind: "progress", fraction, message, delay_ms });

const ok = (receipt: string | null, advisories: Advisory[] = []): SimulatedStep => ({
  kind: "succeeded",
  receipt,
  advisories,
});

const fail = (
  error: string,
  advisory: Advisory | null = null,
  recoverable = true,
): SimulatedStep => ({ kind: "failed", error, recoverable, advisory });

const await_ = (directive: string, escape: string): SimulatedStep => ({
  kind: "awaiting",
  directive,
  escape,
  delay_ms: null,
});

const adv = (
  severity: Severity,
  what: string,
  scope: Scope = "Environment",
  action: Action = "None",
  item: string | null = null,
): Advisory => ({ scope, severity, item, what, action });

// `window_id` the dev_simulate command targets — moss's main window.
const W = "main";

export const WINDOWS: Window[] = [
  // ── Deploy (Preview-scope sim): the glass progress panel ──────────────────
  {
    id: "deploy-success",
    label: "Deploy → Published receipt",
    group: "Deploy",
    surface: "glass progress panel",
    driver: "sim",
    payload: {
      window_id: W,
      scope: "preview",
      tone: "inline",
      kind: "deploy",
      title: "Publishing yinlab.io",
      steps: [
        prog("Uploading 36 files...", 0.25),
        prog("Uploading 110 files...", 0.7),
        prog("Committing...", 0.95, 1500),
        ok("Published · 142 files · 2.1s"),
      ],
    },
  },
  {
    id: "deploy-fail",
    label: "Deploy → Failed (panel row, no toast)",
    group: "Deploy",
    surface: "glass progress panel",
    driver: "sim",
    payload: {
      window_id: W,
      scope: "preview",
      tone: "inline",
      kind: "deploy",
      title: "Publishing yinlab.io",
      steps: [
        prog("Uploading...", 0.4, 1200),
        fail(
          "Upload failed",
          adv(
            "Blocking",
            "Upload failed: connection reset by peer",
            "Remote",
            { InApp: { op: "SignIn", args: {}, label: "Retry" } },
          ),
        ),
      ],
    },
  },

  // ── Domain (Preview-scope sim): the one auto-shown interrupt + DNS run ─────
  {
    id: "domain-awaiting",
    label: "Domain → Awaiting: verify email [Open Settings]",
    group: "Domain",
    surface: "auto-shown panel interrupt",
    driver: "sim",
    payload: {
      window_id: W,
      scope: "preview",
      tone: "awaiting",
      kind: "deploy",
      title: "Connecting yinlab.io",
      steps: [
        prog("Connecting yinlab.io...", null, 1000),
        await_(
          "Verify your email to finish connecting yinlab.io",
          "resend:Open Settings",
        ),
      ],
    },
  },
  {
    id: "domain-configuring",
    label: "Domain → configuring DNS / platform / verifying → live",
    group: "Domain",
    surface: "glass progress panel",
    driver: "sim",
    payload: {
      window_id: W,
      scope: "preview",
      tone: "inline",
      kind: "deploy",
      title: "Connecting yinlab.io",
      steps: [
        prog("Configuring DNS records...", null, 1600),
        prog("Setting up platform...", null, 1600),
        prog("Verifying...", null, 1600),
        ok("yinlab.io is live!"),
      ],
    },
  },

  // ── Plugin (real report_plugin_task_lifecycle seam) ───────────────────────
  {
    id: "syndicate-ok",
    label: "Syndicate → clean success: 'Syndicated · 3 posts'",
    group: "Plugin",
    surface: "Job receipt (no advisory)",
    driver: "plugin",
    payload: {
      hook: "syndicate",
      trigger: "background",
      label: "Syndicating to Matters",
      terminal: { kind: "succeeded", receipt: "Syndicated · 3 posts", advisories: [] },
    },
  },
  {
    id: "gap2",
    label: "Gap-2 → quiet INFO toast: '1 post could not syndicate'",
    group: "Plugin",
    surface: "ephemeral toast (info)",
    driver: "plugin",
    payload: {
      hook: "syndicate",
      trigger: "background",
      label: "Syndicating to Matters",
      terminal: {
        kind: "succeeded",
        receipt: "Syndicated · 2 posts",
        advisories: [adv("ShippedDegraded", "1 post could not be syndicated")],
      },
    },
  },
  {
    id: "gavel",
    label: "Gavel → Blocking advisory flips success to FAILED → error toast",
    group: "Plugin",
    surface: "ephemeral toast (error)",
    driver: "plugin",
    payload: {
      hook: "syndicate",
      trigger: "background",
      label: "Syndicating to Matters",
      terminal: {
        kind: "succeeded",
        receipt: "done",
        advisories: [
          adv(
            "Blocking",
            "Matters subscription required to syndicate",
            "Account",
            { InApp: { op: "OpenBilling", args: {}, label: "Open billing" } },
          ),
        ],
      },
    },
  },
  {
    id: "workspace-fail",
    label: "Workspace job → Failed (Blocking) → error toast",
    group: "Plugin",
    surface: "ephemeral toast (error)",
    driver: "plugin",
    payload: {
      hook: "syndicate",
      trigger: "background",
      label: "Syndicating to Matters",
      terminal: {
        kind: "failed",
        error: "Network unreachable",
        recoverable: false,
        advisories: [
          adv("Blocking", "Network unreachable: could not reach Matters", "Remote"),
        ],
      },
    },
  },

  // ── Build (Workspace-scope sim, kind:build): the degraded-media advisory ──
  {
    id: "ffmpeg-degraded",
    label: "Build media → ShippedDegraded (FFmpeg missing) → info toast",
    group: "Build",
    surface: "ephemeral toast (info)",
    driver: "sim",
    payload: {
      window_id: W,
      scope: "workspace",
      tone: "ambient",
      kind: "build",
      title: "Building site",
      steps: [
        prog("Converting media...", null, 1500),
        ok("Built", [
          adv(
            "ShippedDegraded",
            "FFmpeg not available: videos published unoptimized",
            "Environment",
            { Command: { run: "brew install ffmpeg", label: "Copy" } },
          ),
        ]),
      ],
    },
  },

  // ── Modals (cross-webview event to main shell) ────────────────────────────
  {
    id: "modal-first-publish",
    label: "First Publish — setup state",
    group: "Modal",
    surface: "modal overlay · main webview",
    driver: "modal",
    payload: {
      modalId: "first-publish",
      opts: {
        domain: "liu-guo.com",
        resolvedSiteName: "Liu Guo",
      },
    },
  },
  {
    id: "modal-reverify",
    label: "Re-verify confirm",
    group: "Modal",
    surface: "modal overlay · main webview",
    driver: "modal",
    payload: {
      modalId: "reverify",
      opts: {
        siteId: "test-site",
        email: "dev@example.com",
        siteUrl: "test.mosspub.com",
      },
    },
  },
];
