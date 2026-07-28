/**
 * Token Storage Module
 *
 * Handles secure storage and retrieval of GitHub access tokens.
 *
 * Storage strategy:
 * 1. Primary: Plugin cookies (via moss-api getPluginCookie/setPluginCookie)
 * 2. Fallback: In-memory cache (for current session)
 *
 * Tokens are used for GitHub REST API authentication.
 * The git credential helper is checked opportunistically (works when git
 * is installed, silently falls through to OAuth when it's not).
 */

import { getPluginCookie, setPluginCookie, executeBinary } from "@symbiosis-lab/moss-api";

const GITHUB_HOST = "github.com";
const TOKEN_COOKIE_NAME = "__github_access_token";

// In-memory fallback cache
let cachedToken: string | null = null;

/**
 * Format credentials for git credential helper input
 * (Used for documentation and potential future stdin support)
 */
export function formatCredentialInput(
  host: string,
  protocol: string,
  username?: string,
  password?: string
): string {
  const lines = [`protocol=${protocol}`, `host=${host}`];
  if (username) lines.push(`username=${username}`);
  if (password) lines.push(`password=${password}`);
  lines.push(""); // Empty line to signal end of input
  return lines.join("\n");
}

/**
 * Parse git credential helper output
 */
export function parseCredentialOutput(output: string): {
  username?: string;
  password?: string;
} {
  const result: { username?: string; password?: string } = {};

  for (const line of output.split("\n")) {
    const [key, ...valueParts] = line.split("=");
    const value = valueParts.join("="); // Handle = in values

    if (key === "username") {
      result.username = value;
    } else if (key === "password") {
      result.password = value;
    }
  }

  return result;
}

/**
 * Try to retrieve GitHub token from git credential helper
 *
 * Uses `git credential fill` with stdin input to query the system's
 * configured credential helper (e.g., macOS Keychain, Windows Credential Manager).
 *
 * @returns The token if found in git credentials, null otherwise
 */
export async function getTokenFromGit(gitPath: string = "git"): Promise<string | null> {
  try {
    console.log("   Checking git credential helper for GitHub token...");

    // Format the credential request for github.com
    const input = formatCredentialInput(GITHUB_HOST, "https");

    // Execute git credential fill with stdin
    const result = await executeBinary({
      binaryPath: gitPath,
      args: ["credential", "fill"],
      stdin: input,
      timeoutMs: 5000,
    });

    if (!result.success) {
      console.log("   No credentials found in git credential helper");
      return null;
    }

    // Parse the credential output
    const { password } = parseCredentialOutput(result.stdout);

    if (password) {
      console.log("   Found GitHub token in git credential helper");
      return password;
    }

    console.log("   Git credential helper returned no password");
    return null;
  } catch (error) {
    console.log(`   Git credential helper failed: ${error}`);
    return null;
  }
}

/**
 * Store a GitHub access token
 *
 * Uses plugin cookie storage with in-memory fallback.
 * Note: Plugin identity and project path are auto-detected from runtime context.
 */
export async function storeToken(token: string): Promise<boolean> {
  try {
    console.log("   Storing GitHub access token...");

    // Store in plugin cookies
    try {
      await setPluginCookie([
        {
          name: TOKEN_COOKIE_NAME,
          value: token,
          domain: GITHUB_HOST,
        },
      ]);
      console.log("   Token stored in plugin cookies");
    } catch (error) {
      console.warn(`   Could not store in cookies: ${error}`);
    }

    // Always cache in memory as fallback
    cachedToken = token;

    console.log("   Token stored successfully");
    return true;
  } catch (error) {
    console.error(`   Error storing token: ${error}`);
    return false;
  }
}

/**
 * Retrieve GitHub access token
 *
 * Checks plugin cookies first, then falls back to memory cache.
 * Note: Plugin identity and project path are auto-detected from runtime context.
 */
export async function getToken(): Promise<string | null> {
  // Check memory cache first (faster)
  if (cachedToken) {
    return cachedToken;
  }

  // Try plugin cookies
  try {
    const cookies = await getPluginCookie();
    const tokenCookie = cookies?.find((c) => c.name === TOKEN_COOKIE_NAME);

    if (tokenCookie) {
      cachedToken = tokenCookie.value;
      return cachedToken;
    }
  } catch {
    // Cookie retrieval failed, token not available
  }

  return null;
}

/**
 * Clear the cached token
 */
export function clearTokenCache(): void {
  cachedToken = null;
}

/**
 * Remove GitHub access token
 * Note: Plugin identity and project path are auto-detected from runtime context.
 */
export async function clearToken(): Promise<boolean> {
  try {
    console.log("   Clearing GitHub access token...");

    // Clear from plugin cookies
    try {
      await setPluginCookie([]);
    } catch {
      // Ignore cookie clear errors
    }

    // Clear memory cache
    cachedToken = null;

    console.log("   Token cleared successfully");
    return true;
  } catch (error) {
    console.error(`   Error clearing token: ${error}`);
    return false;
  }
}

