/**
 * E2E Test Setup for Matters Plugin
 *
 * Configures the test environment for e2e tests that run against
 * the Matters test environment (matters.icu).
 *
 * Required Environment Variables:
 * - MATTERS_TEST_WALLET_PRIVATE_KEY: Ethereum private key for authentication
 * - MATTERS_TEST_USER: Username for public queries (default: yhh354)
 * - MATTERS_TEST_ARTICLE_HASH: Article shortHash for social data tests
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

beforeAll(() => {
  // Configure API for test environment
  apiConfig.endpoint = process.env.MATTERS_TEST_ENDPOINT || DEFAULT_ENDPOINT;
  apiConfig.queryMode = "user";
  apiConfig.testUserName = process.env.MATTERS_TEST_USER || DEFAULT_TEST_USER;

  console.log("🧪 E2E Test Environment Configuration:");
  console.log(`   Endpoint: ${apiConfig.endpoint}`);
  console.log(`   Query Mode: ${apiConfig.queryMode}`);
  console.log(`   Test User: ${apiConfig.testUserName}`);

  // Check for wallet authentication
  if (process.env.MATTERS_TEST_WALLET_PRIVATE_KEY) {
    console.log("   ✅ Wallet authentication available");
  } else {
    console.warn("   ⚠️ MATTERS_TEST_WALLET_PRIVATE_KEY not set");
    console.warn("      Some tests requiring authentication will be skipped or use mocks");
  }

  // Check for test article hash
  if (process.env.MATTERS_TEST_ARTICLE_HASH) {
    console.log(`   Test Article: ${process.env.MATTERS_TEST_ARTICLE_HASH}`);
  } else {
    console.log("   Test Article: Using default article from test user");
  }
});

beforeEach(() => {
  // Reset API config before each test to ensure clean state
  apiConfig.endpoint = process.env.MATTERS_TEST_ENDPOINT || DEFAULT_ENDPOINT;
  apiConfig.queryMode = "user";
  apiConfig.testUserName = process.env.MATTERS_TEST_USER || DEFAULT_TEST_USER;
});

afterAll(async () => {
  // Cleanup: No specific cleanup needed for e2e tests
  // Drafts created during testing can be manually deleted if needed
  console.log("🧹 E2E Test cleanup complete");
});

/**
 * Helper to check if wallet authentication is available
 */
export function hasWalletAuth(): boolean {
  return !!process.env.MATTERS_TEST_WALLET_PRIVATE_KEY;
}

/**
 * Helper to skip test if wallet auth is not available
 */
export function skipIfNoWalletAuth(): void {
  if (!hasWalletAuth()) {
    console.warn("⏭️ Test skipped: MATTERS_TEST_WALLET_PRIVATE_KEY not set");
  }
}

/**
 * Get the test endpoint
 */
export function getTestEndpoint(): string {
  return process.env.MATTERS_TEST_ENDPOINT || DEFAULT_ENDPOINT;
}

/**
 * Get the test user name
 */
export function getTestUser(): string {
  return process.env.MATTERS_TEST_USER || DEFAULT_TEST_USER;
}
