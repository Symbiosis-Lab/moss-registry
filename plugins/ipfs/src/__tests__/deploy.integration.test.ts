import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IpfsProvider } from "../providers/types";

// --- moss-api stub -----------------------------------------------------------
const api = vi.hoisted(() => ({
  files: {} as Record<string, string>,
  toasts: [] as Array<Record<string, unknown>>,
  progress: [] as Array<{ phase: string; step: number; msg?: string }>,
}));

vi.mock("@symbiosis-lab/moss-api", () => ({
  setMessageContext: vi.fn(),
  reportProgress: vi.fn(async (phase: string, step: number, _total: number, msg?: string) => {
    api.progress.push({ phase, step, msg });
  }),
  reportError: vi.fn(),
  showToast: vi.fn(async (opts: Record<string, unknown>) => {
    api.toasts.push(opts);
  }),
  dismissToast: vi.fn(),
  openBrowserWithHtml: vi.fn(),
  onEvent: vi.fn(),
  httpPost: vi.fn(),
  httpPostMultipart: vi.fn(),
  executeBinary: vi.fn(),
  getPluginCookie: vi.fn(),
  setPluginCookie: vi.fn(),
  getPluginEnvVar: vi.fn(),
  pluginFileExists: vi.fn(async (name: string) => api.files[name] !== undefined),
  readPluginFile: vi.fn(async (name: string) => api.files[name] ?? ""),
  writePluginFile: vi.fn(async (name: string, content: string) => {
    api.files[name] = content;
  }),
  readSiteFile: vi.fn(async () => "aGVsbG8="),
}));

// --- identity IPNS stub ------------------------------------------------------
// The site's only IPNS owner; main.ts must fail the deploy when it fails.
const ipns = vi.hoisted(() => ({
  outcome: { name: "k51identity", sequence: 2n } as Record<string, unknown>,
  calls: 0,
}));
vi.mock("../ipns-identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ipns-identity")>();
  return {
    ...actual,
    publishIdentityIpns: vi.fn(async () => {
      ipns.calls++;
      return ipns.outcome;
    }),
  };
});

// --- provider stub -----------------------------------------------------------
const providerRef = vi.hoisted(() => ({
  current: null as IpfsProvider | null,
  secondary: null as IpfsProvider | null,
}));
vi.mock("../providers", () => ({
  getProvider: () => providerRef.current,
  makeProviderById: () => providerRef.secondary,
}));

import { deploy } from "../main";

function makeProvider(overrides: Partial<IpfsProvider> = {}): IpfsProvider {
  return {
    id: "pinata",
    label: "Pinata",
    checkReady: vi.fn(async () => ({ ready: true as const })),
    uploadDir: vi.fn(async (_files, onProgress) => {
      onProgress(50, "Uploading...");
      return { cid: "bafyNEW", sizeBytes: 123 };
    }),
    verifyDirectory: vi.fn(async () => "ok" as const),
    gatewayUrl: (cid: string) => `https://gateway.pinata.cloud/ipfs/${cid}`,
    ...overrides,
  };
}

/** Plugin state with structure already verified (skips probing). */
const CACHED_STATE = JSON.stringify({
  structureVerified: { pinata: true },
  lastCid: "bafyOLD", // not first deploy → no result panel
});

/** Plugin state with nothing verified yet (verification path runs). */
const FRESH_STATE = JSON.stringify({ lastCid: "bafyOLD" });

/** Settings as the host hands them over: manifest keys, already merged. */
const SETTINGS = { provider: "pinata", use_ipns: false };

const flatContext = { site_files: ["index.html"], config: SETTINGS } as never;
const nestedContext = {
  site_files: ["index.html", "assets/app.css"],
  config: SETTINGS,
} as never;

/** The state the plugin persisted during a deploy. */
function state(): Record<string, unknown> {
  return JSON.parse(api.files["state.json"] ?? "{}") as Record<string, unknown>;
}

beforeEach(() => {
  api.files = { "state.json": CACHED_STATE };
  api.toasts = [];
  api.progress = [];
  ipns.outcome = { name: "k51identity", sequence: 2n };
  ipns.calls = 0;
  providerRef.current = makeProvider();
  providerRef.secondary = null;
  vi.clearAllMocks();
});

describe("deploy — happy path (already verified)", () => {
  it("returns an ipfs deployment and shows a success toast with a View-site link", async () => {
    const result = await deploy(flatContext);
    expect(result.success).toBe(true);
    expect(result.deployment?.method).toBe("ipfs");
    expect(result.deployment?.metadata?.cid).toBe("bafyNEW");
    expect(result.deployment?.url).toContain("bafyNEW");

    // Already verified → no verification round.
    expect(providerRef.current?.verifyDirectory).not.toHaveBeenCalled();

    expect(api.toasts).toHaveLength(1);
    expect(api.toasts[0].variant).toBe("success");
    const actions = api.toasts[0].actions as Array<{ label: string; url: string }>;
    expect(actions[0].label).toBe("View site");
    expect(actions[0].url).toContain("bafyNEW");

    expect(api.progress.at(-1)).toMatchObject({ phase: "complete", step: 10 });
  });

  it("emits a DNSLink dns_target when a custom domain is set", async () => {
    const result = await deploy({
      site_files: ["index.html"],
      config: SETTINGS,
      domain: "example.com",
    } as never);
    const txt = result.deployment?.dns_target?.records.find((r) => r.record_type === "TXT");
    expect(txt?.name).toBe("_dnslink");
    expect(txt?.value).toContain("/ipfs/bafyNEW");
  });
});

describe("deploy — structure verification", () => {
  it("verifies once and persists the result per provider", async () => {
    api.files["state.json"] = FRESH_STATE;
    const result = await deploy(nestedContext);
    expect(result.success).toBe(true);
    expect(providerRef.current?.verifyDirectory).toHaveBeenCalledWith("bafyNEW", "assets/app.css");
    expect(state().structureVerified).toEqual({ pinata: true });
  });

  it("skips verification for a flat site (nothing can lose structure)", async () => {
    api.files["state.json"] = FRESH_STATE;
    const result = await deploy(flatContext);
    expect(result.success).toBe(true);
    expect(providerRef.current?.verifyDirectory).not.toHaveBeenCalled();
    expect(state().structureVerified).toEqual({ pinata: true });
  });

  it("fails loudly on a CONFIRMED broken structure (never a silent broken site)", async () => {
    api.files["state.json"] = FRESH_STATE;
    providerRef.current = makeProvider({
      verifyDirectory: vi.fn(async () => "broken" as const),
    });
    const result = await deploy(nestedContext);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/did not preserve the site's folder structure/);
    expect(api.toasts.at(-1)?.variant).toBe("error");
    // Only one upload — there is deliberately no retry path.
    expect(providerRef.current?.uploadDir).toHaveBeenCalledTimes(1);
    expect(state().structureVerified).toBeUndefined();
  });

  it("skips the probe entirely when the upload response proved the structure", async () => {
    api.files["state.json"] = FRESH_STATE;
    providerRef.current = makeProvider({
      uploadDir: vi.fn(async () => ({ cid: "bafyNEW", sizeBytes: 9, verified: true })),
    });
    const result = await deploy(nestedContext);
    expect(result.success).toBe(true);
    expect(providerRef.current?.verifyDirectory).not.toHaveBeenCalled();
    expect(state().structureVerified).toEqual({ pinata: true });
  });

  it("treats a response-disproven structure as broken without probing first", async () => {
    api.files["state.json"] = FRESH_STATE;
    providerRef.current = makeProvider({
      uploadDir: vi.fn(async () => ({ cid: "bafyMULTI", sizeBytes: 1, verified: false })),
    });
    const result = await deploy(nestedContext);
    expect(result.success).toBe(false);
    expect(providerRef.current?.verifyDirectory).not.toHaveBeenCalled();
    expect(result.message).toMatch(/did not preserve the site's folder structure/);
  });

  it("persists nothing on an inconclusive probe (re-verifies next deploy)", async () => {
    api.files["state.json"] = FRESH_STATE;
    providerRef.current = makeProvider({
      verifyDirectory: vi.fn(async () => "inconclusive" as const),
    });
    const result = await deploy(nestedContext);
    expect(result.success).toBe(true); // multipart result stands
    expect(state().structureVerified).toBeUndefined();
    // No CAR retry on a transient failure.
    expect(providerRef.current?.uploadDir).toHaveBeenCalledTimes(1);
  });
});

describe("deploy — co-pinning", () => {
  const copinContext = {
    site_files: ["index.html"],
    config: { ...SETTINGS, co_pin: true },
  } as never;

  it("pins to the ready secondary and notes it, without changing the address", async () => {
    providerRef.secondary = makeProvider({
      id: "local",
      label: "Local Kubo node",
      uploadDir: vi.fn(async () => ({ cid: "bafyNEW", sizeBytes: 123 })),
    });
    const result = await deploy(copinContext);
    expect(result.success).toBe(true);
    expect(providerRef.secondary?.uploadDir).toHaveBeenCalledTimes(1);
    expect(result.message).toMatch(/Also pinned to your local node/);
    expect(result.deployment?.metadata?.cid).toBe("bafyNEW");
  });

  it("skips silently when the secondary isn't ready", async () => {
    providerRef.secondary = makeProvider({
      id: "local",
      checkReady: vi.fn(async () => ({ ready: false as const, reason: "daemon down" })),
    });
    const result = await deploy(copinContext);
    expect(result.success).toBe(true);
    expect(providerRef.secondary?.uploadDir).not.toHaveBeenCalled();
    expect(result.message).not.toMatch(/Also pinned/);
  });

  it("does NOT claim a keeper when the secondary returns a different CID", async () => {
    providerRef.secondary = makeProvider({
      id: "local",
      label: "Local Kubo node",
      uploadDir: vi.fn(async () => ({ cid: "bafyDIFFERENT", sizeBytes: 123 })),
    });
    const result = await deploy(copinContext);
    expect(result.success).toBe(true);
    expect(result.message).not.toMatch(/Also pinned/);
  });

  it("never fails the deploy when the secondary throws", async () => {
    providerRef.secondary = makeProvider({
      id: "local",
      uploadDir: vi.fn(async () => {
        throw new Error("secondary exploded");
      }),
    });
    const result = await deploy(copinContext);
    expect(result.success).toBe(true);
    expect(result.message).not.toMatch(/Also pinned/);
  });
});

describe("deploy — readiness gate", () => {
  it("fails with the provider's reason when not ready — fixing it belongs to check_setup, never mid-deploy UI", async () => {
    providerRef.current = makeProvider({
      checkReady: vi.fn(async () => ({ ready: false as const, reason: "Connect Pinata." })),
    });
    const result = await deploy(flatContext);
    expect(result.success).toBe(false);
    expect(result.message).toBe("Connect Pinata.");
    expect(result.deployment).toBeUndefined();
    expect(providerRef.current?.uploadDir).not.toHaveBeenCalled();
  });
});

describe("deploy — one IPNS owner", () => {
  const ipnsContext = {
    site_files: ["index.html"],
    config: { provider: "pinata", use_ipns: true },
  } as never;

  it("publishes the identity name and records that the deploy used it", async () => {
    const result = await deploy(ipnsContext);
    expect(result.success).toBe(true);
    expect(result.deployment?.metadata?.ipns_name).toBe("k51identity");
    expect(state().lastUsedIpns).toBe(true);
  });

  it("FAILS the deploy when the IPNS publish fails, naming the reason", async () => {
    // The only other key available is the node's own keystore, which would put
    // the site at a different permanent address. Reporting success while the
    // stable URL still served the previous deploy is the failure to avoid.
    ipns.outcome = { reason: "the IPFS node rejected the IPNS record (HTTP 500)" };
    const result = await deploy(ipnsContext);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/rejected the IPNS record/);
    expect(result.deployment).toBeUndefined();
    expect(api.toasts.at(-1)?.variant).toBe("error");
    expect(state().lastCid).toBe("bafyOLD"); // no success recorded
  });

  it("does not touch IPNS at all when the setting is off", async () => {
    const result = await deploy(flatContext);
    expect(result.success).toBe(true);
    expect(ipns.calls).toBe(0);
    expect(result.deployment?.metadata?.ipns_name).toBe("");
    expect(state().lastUsedIpns).toBe(false);
  });
});

describe("deploy — errors", () => {
  it("categorizes an auth failure into an error toast and returns failure", async () => {
    providerRef.current = makeProvider({
      uploadDir: vi.fn(async () => {
        throw new Error("Pinata authentication failed (HTTP 401).");
      }),
    });
    const result = await deploy(flatContext);
    expect(result.success).toBe(false);
    expect(result.deployment).toBeUndefined();
    expect(api.toasts.at(-1)).toMatchObject({ variant: "error", message: "Authentication failed" });
  });

  it("rejects an empty site", async () => {
    const result = await deploy({ site_files: [], config: {} } as never);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/build your site/i);
  });
});
