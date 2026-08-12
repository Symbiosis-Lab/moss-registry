import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IpfsProvider } from "../providers/types";

// --- moss-api stub -----------------------------------------------------------
const api = vi.hoisted(() => ({
  configFile: "",
  writes: [] as string[],
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
  closeBrowser: vi.fn(),
  openBrowserWithHtml: vi.fn(),
  onEvent: vi.fn(),
  httpPost: vi.fn(),
  httpPostMultipart: vi.fn(),
  executeBinary: vi.fn(),
  getPluginCookie: vi.fn(),
  setPluginCookie: vi.fn(),
  getPluginEnvVar: vi.fn(),
  pluginFileExists: vi.fn(async () => api.configFile !== ""),
  readPluginFile: vi.fn(async () => api.configFile),
  writePluginFile: vi.fn(async (_name: string, content: string) => {
    api.writes.push(content);
    api.configFile = content;
  }),
  readSiteFile: vi.fn(async () => "aGVsbG8="),
  fetchUrl: vi.fn(async () => ({ ok: true, status: 200 })),
}));

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
    runSetup: vi.fn(async () => true),
    uploadDir: vi.fn(async (_files, onProgress) => {
      onProgress(50, "Uploading...");
      return { cid: "bafyNEW", sizeBytes: 123 };
    }),
    verifyDirectory: vi.fn(async () => "ok" as const),
    publishIpns: vi.fn(async () => undefined),
    gatewayUrl: (cid: string) => `https://gateway.pinata.cloud/ipfs/${cid}`,
    ...overrides,
  };
}

/** Persisted config with structure already verified (skips probing). */
const CACHED_CONFIG = JSON.stringify({
  provider: "pinata",
  useIpns: false,
  structureVerified: { pinata: true },
  lastCid: "bafyOLD", // not first deploy → no result panel
});

/** Persisted config with nothing verified yet (verification path runs). */
const FRESH_CONFIG = JSON.stringify({
  provider: "pinata",
  useIpns: false,
  lastCid: "bafyOLD",
});

const flatContext = { site_files: ["index.html"], config: {} } as never;
const nestedContext = { site_files: ["index.html", "assets/app.css"], config: {} } as never;

beforeEach(() => {
  api.configFile = CACHED_CONFIG;
  api.writes = [];
  api.toasts = [];
  api.progress = [];
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
    const result = await deploy({ site_files: ["index.html"], config: {}, domain: "example.com" } as never);
    const txt = result.deployment?.dns_target?.records.find((r) => r.record_type === "TXT");
    expect(txt?.name).toBe("_dnslink");
    expect(txt?.value).toContain("/ipfs/bafyNEW");
  });
});

describe("deploy — structure verification", () => {
  it("verifies once, persists the result per provider, and marks structure_verified", async () => {
    api.configFile = FRESH_CONFIG;
    const result = await deploy(nestedContext);
    expect(result.success).toBe(true);
    expect(providerRef.current?.verifyDirectory).toHaveBeenCalledWith("bafyNEW", "assets/app.css");
    expect(result.deployment?.metadata?.structure_verified).toBe("true");
    const finalConfig = JSON.parse(api.configFile);
    expect(finalConfig.structureVerified).toEqual({ pinata: true });
  });

  it("skips verification for a flat site (nothing can lose structure)", async () => {
    api.configFile = FRESH_CONFIG;
    const result = await deploy(flatContext);
    expect(providerRef.current?.verifyDirectory).not.toHaveBeenCalled();
    expect(result.deployment?.metadata?.structure_verified).toBe("true");
  });

  it("fails loudly on a CONFIRMED broken structure (never a silent broken site)", async () => {
    api.configFile = FRESH_CONFIG;
    providerRef.current = makeProvider({
      verifyDirectory: vi.fn(async () => "broken" as const),
    });
    const result = await deploy(nestedContext);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/did not preserve the site's folder structure/);
    expect(api.toasts.at(-1)?.variant).toBe("error");
    // Only one upload — there is deliberately no retry path.
    expect(providerRef.current?.uploadDir).toHaveBeenCalledTimes(1);
    expect(JSON.parse(api.configFile).structureVerified).toBeUndefined();
  });

  it("skips the probe entirely when the upload response proved the structure", async () => {
    api.configFile = FRESH_CONFIG;
    providerRef.current = makeProvider({
      uploadDir: vi.fn(async () => ({ cid: "bafyNEW", sizeBytes: 9, verified: true })),
    });
    const result = await deploy(nestedContext);
    expect(result.success).toBe(true);
    expect(providerRef.current?.verifyDirectory).not.toHaveBeenCalled();
    expect(result.deployment?.metadata?.structure_verified).toBe("true");
    expect(JSON.parse(api.configFile).structureVerified).toEqual({ pinata: true });
  });

  it("treats a response-disproven structure as broken without probing first", async () => {
    api.configFile = FRESH_CONFIG;
    providerRef.current = makeProvider({
      uploadDir: vi.fn(async () => ({ cid: "bafyMULTI", sizeBytes: 1, verified: false })),
    });
    const result = await deploy(nestedContext);
    expect(result.success).toBe(false);
    expect(providerRef.current?.verifyDirectory).not.toHaveBeenCalled();
    expect(result.message).toMatch(/did not preserve the site's folder structure/);
  });

  it("persists nothing on an inconclusive probe (re-verifies next deploy)", async () => {
    api.configFile = FRESH_CONFIG;
    providerRef.current = makeProvider({
      verifyDirectory: vi.fn(async () => "inconclusive" as const),
    });
    const result = await deploy(nestedContext);
    expect(result.success).toBe(true); // multipart result stands
    expect(result.deployment?.metadata?.structure_verified).toBe("false");
    expect(JSON.parse(api.configFile).structureVerified).toBeUndefined();
    // No CAR retry on a transient failure.
    expect(providerRef.current?.uploadDir).toHaveBeenCalledTimes(1);
  });
});

describe("deploy — co-pinning", () => {
  const COPIN_CONFIG = JSON.stringify({
    provider: "pinata",
    useIpns: false,
    coPin: true,
    structureVerified: { pinata: true },
    lastCid: "bafyOLD",
  });

  it("pins to the ready secondary and notes it, without changing the address", async () => {
    api.configFile = COPIN_CONFIG;
    providerRef.secondary = makeProvider({
      id: "local",
      label: "Local Kubo node",
      uploadDir: vi.fn(async () => ({ cid: "bafyNEW", sizeBytes: 123 })),
    });
    const result = await deploy(flatContext);
    expect(result.success).toBe(true);
    expect(providerRef.secondary?.uploadDir).toHaveBeenCalledTimes(1);
    expect(result.message).toMatch(/Also pinned to your local node/);
    expect(result.deployment?.metadata?.co_pinned).toBe("local");
    expect(result.deployment?.metadata?.cid).toBe("bafyNEW");
  });

  it("skips silently when the secondary isn't ready", async () => {
    api.configFile = COPIN_CONFIG;
    providerRef.secondary = makeProvider({
      id: "local",
      checkReady: vi.fn(async () => ({ ready: false as const, reason: "daemon down" })),
    });
    const result = await deploy(flatContext);
    expect(result.success).toBe(true);
    expect(providerRef.secondary?.uploadDir).not.toHaveBeenCalled();
    expect(result.deployment?.metadata?.co_pinned).toBe("");
  });

  it("does NOT claim a keeper when the secondary returns a different CID", async () => {
    api.configFile = COPIN_CONFIG;
    providerRef.secondary = makeProvider({
      id: "local",
      label: "Local Kubo node",
      uploadDir: vi.fn(async () => ({ cid: "bafyDIFFERENT", sizeBytes: 123 })),
    });
    const result = await deploy(flatContext);
    expect(result.success).toBe(true);
    expect(result.deployment?.metadata?.co_pinned).toBe("");
    expect(result.message).not.toMatch(/Also pinned/);
  });

  it("never fails the deploy when the secondary throws", async () => {
    api.configFile = COPIN_CONFIG;
    providerRef.secondary = makeProvider({
      id: "local",
      uploadDir: vi.fn(async () => {
        throw new Error("secondary exploded");
      }),
    });
    const result = await deploy(flatContext);
    expect(result.success).toBe(true);
    expect(result.deployment?.metadata?.co_pinned).toBe("");
    expect(api.toasts.at(-1)?.variant).toBe("success");
  });
});

describe("deploy — setup gate", () => {
  it("runs setup when not ready, then resumes", async () => {
    let ready = false;
    providerRef.current = makeProvider({
      checkReady: vi.fn(async () => (ready ? { ready: true as const } : { ready: false as const, reason: "Connect Pinata." })),
      runSetup: vi.fn(async () => {
        ready = true;
        return true;
      }),
    });
    const result = await deploy(flatContext);
    expect(providerRef.current.runSetup).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("fails cleanly when the user cancels setup", async () => {
    providerRef.current = makeProvider({
      checkReady: vi.fn(async () => ({ ready: false as const, reason: "Connect Pinata." })),
      runSetup: vi.fn(async () => false),
    });
    const result = await deploy(flatContext);
    expect(result.success).toBe(false);
    expect(result.deployment).toBeUndefined();
  });
});

describe("deploy — IPNS degradation is loud", () => {
  it("notes a failed IPNS publish in the result message", async () => {
    api.configFile = JSON.stringify({
      provider: "pinata",
      useIpns: true,
      structureVerified: { pinata: true },
      lastCid: "bafyOLD",
    });
    providerRef.current = makeProvider({ publishIpns: vi.fn(async () => undefined) });
    const result = await deploy(flatContext);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/IPNS publish failed/);
    expect(result.deployment?.metadata?.ipns_name).toBe("");
  });

  it("notes when the provider has no IPNS support at all", async () => {
    api.configFile = JSON.stringify({
      provider: "pinata",
      useIpns: true,
      structureVerified: { pinata: true },
      lastCid: "bafyOLD",
    });
    providerRef.current = makeProvider({ publishIpns: undefined });
    const result = await deploy(flatContext);
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/does not support IPNS/);
  });

  it("includes the IPNS name when publishing succeeds", async () => {
    api.configFile = JSON.stringify({
      provider: "pinata",
      useIpns: true,
      structureVerified: { pinata: true },
      lastCid: "bafyOLD",
    });
    providerRef.current = makeProvider({ publishIpns: vi.fn(async () => "k51new") });
    const result = await deploy(flatContext);
    expect(result.deployment?.metadata?.ipns_name).toBe("k51new");
    expect(result.message).not.toMatch(/IPNS publish failed/);
    expect(JSON.parse(api.configFile).lastUsedIpns).toBe(true);
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
