/**
 * Features-project setup: run the plugin's REAL API layer against matters.icu.
 *
 * Configures the test environment for the live suites (features/steps/*) that
 * run against the Matters test environment (matters.icu).
 *
 * Required Environment Variables:
 * - MATTERS_TEST_WALLET_PRIVATE_KEY: Ethereum private key for authentication
 *   (auth-required suites skip loudly without it — see test-helpers/TEST_ACCOUNT.md)
 * - MATTERS_TEST_USER: Username for public queries (default: yhh354)
 *
 * Optional Environment Variables:
 * - MATTERS_TEST_ENDPOINT: GraphQL endpoint (default: https://server.matters.icu/graphql)
 */

import { beforeAll, afterAll, beforeEach } from "vitest";
import { apiConfig } from "../src/api";

// Default test user with known articles on matters.icu
const DEFAULT_TEST_USER = "yhh354";

// Default endpoint for test environment
const DEFAULT_ENDPOINT = "https://server.matters.icu/graphql";

// ============================================================================
// Tauri HTTP shim
// ============================================================================

interface TauriFetchResult {
  status: number;
  ok: boolean;
  content_type: string | null;
  body_base64: string;
}

async function serveFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<TauriFetchResult> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const body = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    ok: response.ok,
    content_type: response.headers.get("content-type"),
    body_base64: body.toString("base64"),
  };
}

/**
 * src/api.ts reaches the network through `window.__TAURI__.core.invoke` — in
 * the app that lands in Rust's HTTP client. The features project runs under
 * node, so serve the three HTTP commands with real fetch and refuse everything
 * else BY NAME: steps drive the real plugin code against server.matters.icu,
 * and a step that wanders onto an app-only command fails with the command
 * name instead of "window is not defined".
 *
 * Files that call `setupMockTauri()` (download/self-correcting steps) replace
 * this shim inside their own worker; each test file gets a fresh module graph,
 * so the two never meet.
 */
async function invokeShim<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const a = args as {
    url?: string;
    body?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
  };
  const timeoutMs = a.timeoutMs ?? 30000;
  switch (cmd) {
    case "http_post":
      return serveFetch(
        a.url!,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(a.headers ?? {}) },
          body: a.body,
        },
        timeoutMs
      ) as Promise<T>;
    case "http_get":
    case "fetch_url":
      return serveFetch(a.url!, { headers: a.headers ?? {} }, timeoutMs) as Promise<T>;
    default:
      throw new Error(
        `features HTTP shim: unhandled Tauri command '${cmd}' — extend test-setup/e2e.ts or use setupMockTauri() in the step file`
      );
  }
}

beforeAll(() => {
  const g = globalThis as unknown as {
    window?: { __TAURI__?: unknown };
  };
  if (typeof g.window === "undefined") {
    g.window = {};
  }
  if (!g.window.__TAURI__) {
    g.window.__TAURI__ = { core: { invoke: invokeShim } };
  }

  // Configure API for test environment
  apiConfig.endpoint = process.env.MATTERS_TEST_ENDPOINT || DEFAULT_ENDPOINT;
  apiConfig.queryMode = "user";
  apiConfig.testUserName = process.env.MATTERS_TEST_USER || DEFAULT_TEST_USER;

  console.log("🧪 E2E Test Environment Configuration:");
  console.log(`   Endpoint: ${apiConfig.endpoint}`);
  console.log(`   Query Mode: ${apiConfig.queryMode}`);
  console.log(`   Test User: ${apiConfig.testUserName}`);

  if (process.env.MATTERS_TEST_WALLET_PRIVATE_KEY) {
    console.log("   ✅ Wallet authentication available");
  } else {
    console.warn("   ⚠️ MATTERS_TEST_WALLET_PRIVATE_KEY not set");
    console.warn("      Suites requiring authentication skip themselves loudly");
  }
});

beforeEach(() => {
  // Reset API config before each test to ensure clean state
  apiConfig.endpoint = process.env.MATTERS_TEST_ENDPOINT || DEFAULT_ENDPOINT;
  apiConfig.queryMode = "user";
  apiConfig.testUserName = process.env.MATTERS_TEST_USER || DEFAULT_TEST_USER;
});

afterAll(() => {
  // Cleanup: No specific cleanup needed for e2e tests
  // Drafts created during testing can be manually deleted if needed
  console.log("🧹 E2E Test cleanup complete");
});
