/**
 * GitHub OAuth Device Flow Authentication Module
 *
 * Implements the OAuth 2.0 Device Authorization Grant (RFC 8628)
 * for GitHub authentication. This flow is ideal for CLI/desktop apps
 * that can't easily handle redirect callbacks.
 *
 * Flow:
 * 1. Request device code from GitHub
 * 2. Open browser for user to enter code
 * 3. Poll for access token
 * 4. Store token in git credential helper
 */

import { openSystemBrowser, httpPost, openBrowserWithHtml, closeBrowser, onEvent } from "@symbiosis-lab/moss-api";
import { sleep, reportProgress } from "./utils";
import { storeToken, getToken, clearToken, getTokenFromGit } from "./token";
import type {
  DeviceCodeResponse,
  TokenResponse,
  GitHubUser,
  AuthState,
} from "./types";

// ============================================================================
// Configuration
// ============================================================================

/** GitHub OAuth App Client ID for moss */
const CLIENT_ID = "Ov23li8HTgRH8nuO16oK";

/** Required OAuth scopes for GitHub Pages deployment
 * Note: We only need "repo" scope for gh-pages deployment since we push directly
 * to the gh-pages branch. The "workflow" scope is NOT needed because we don't
 * use GitHub Actions for deployment. (Bug 23 fix)
 */
const REQUIRED_SCOPES = ["repo"];

/** GitHub API endpoints */
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_USER_URL = "https://api.github.com/user";

/** Maximum time to wait for user authorization (5 minutes) */
const MAX_POLL_TIME_MS = 300000;

// ============================================================================
// Device Flow Implementation
// ============================================================================

/**
 * Request a device code from GitHub
 *
 * Uses httpPost to bypass CORS restrictions in Tauri WebView.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  console.log("   Requesting device code from GitHub...");

  const response = await httpPost(
    GITHUB_DEVICE_CODE_URL,
    {
      client_id: CLIENT_ID,
      scope: REQUIRED_SCOPES.join(" "),
    },
    {
      headers: {
        Accept: "application/json",
        Origin: "https://github.com",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to request device code: ${response.status} ${response.text()}`);
  }

  const data = JSON.parse(response.text());

  if (data.error) {
    throw new Error(`GitHub error: ${data.error_description || data.error}`);
  }

  console.log(`   Device code received. User code: ${data.user_code}`);

  return data as DeviceCodeResponse;
}

/**
 * Poll GitHub for access token
 *
 * Uses httpPost to bypass CORS restrictions in Tauri WebView.
 *
 * Returns the token response, which may contain:
 * - access_token: Success!
 * - error: "authorization_pending" - Keep polling
 * - error: "slow_down" - Increase interval
 * - error: "expired_token" - Device code expired
 * - error: "access_denied" - User denied authorization
 */
export async function pollForToken(
  deviceCode: string,
  _interval: number
): Promise<TokenResponse> {
  const response = await httpPost(
    GITHUB_TOKEN_URL,
    {
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    },
    {
      headers: {
        Accept: "application/json",
        Origin: "https://github.com",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to poll for token: ${response.status} ${response.text()}`);
  }

  return JSON.parse(response.text()) as TokenResponse;
}

/**
 * Validate an access token by calling the GitHub API
 */
export async function validateToken(token: string): Promise<{
  valid: boolean;
  user?: GitHubUser;
  scopes?: string[];
}> {
  try {
    const response = await fetch(GITHUB_API_USER_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "moss-GitHub-Deployer",
      },
    });

    if (!response.ok) {
      return { valid: false };
    }

    const user = (await response.json()) as GitHubUser;

    // Get scopes from response headers
    const scopeHeader = response.headers.get("X-OAuth-Scopes") || "";
    const scopes = scopeHeader.split(",").map((s) => s.trim()).filter(Boolean);

    return { valid: true, user, scopes };
  } catch {
    return { valid: false };
  }
}

/**
 * Check if we have required scopes
 */
export function hasRequiredScopes(scopes: string[]): boolean {
  return REQUIRED_SCOPES.every((required) => scopes.includes(required));
}

// ============================================================================
// High-Level Authentication Functions
// ============================================================================

/**
 * Check if user is authenticated with valid GitHub credentials
 *
 * Checks in order:
 * 1. Plugin cookies (fastest - cached from previous auth)
 * 2. Git credential helper (system-stored tokens)
 *
 * Note: Plugin identity and project path are auto-detected from runtime context.
 */
export async function checkAuthentication(): Promise<AuthState> {
  console.log("   Checking GitHub authentication...");

  // 1. Try to get token from plugin cookies (fastest)
  let token = await getToken();

  if (token) {
    // Validate the cached token
    const validation = await validateToken(token);

    if (validation.valid && hasRequiredScopes(validation.scopes || [])) {
      console.log(`   Authenticated as ${validation.user?.login} (from plugin cookies)`);
      return {
        isAuthenticated: true,
        username: validation.user?.login,
        scopes: validation.scopes,
      };
    }

    // Token is invalid - clear it and try git credentials
    console.log("   Cached token invalid, clearing...");
    await clearToken();
  }

  // 2. Try git credential helper (Bug 8 fix)
  console.log("   Checking git credential helper...");
  token = await getTokenFromGit();

  if (token) {
    const validation = await validateToken(token);

    if (validation.valid && hasRequiredScopes(validation.scopes || [])) {
      // Store in plugin cookies for faster future access
      await storeToken(token);
      console.log(`   Authenticated as ${validation.user?.login} (from git credentials)`);
      return {
        isAuthenticated: true,
        username: validation.user?.login,
        scopes: validation.scopes,
      };
    }

    console.log("   Git credential token lacks required scopes or is invalid");
  }

  console.log("   No valid credentials found");
  return { isAuthenticated: false };
}

/**
 * Run the full OAuth Device Flow to authenticate the user
 *
 * This will:
 * 1. Request a device code
 * 2. Show auth UI panel with the user code
 * 3. Open the system browser with pre-filled verification URL
 * 4. Poll for the access token (cancellable via auth UI)
 * 5. Store the token in plugin cookies
 * 6. Close the auth UI panel
 */
export async function promptLogin(): Promise<boolean> {
  try {
    // Step 1: Request device code
    await reportProgress("authentication", 0, 4, "Requesting authorization...");
    const deviceCodeResponse = await requestDeviceCode();

    const userCode = deviceCodeResponse.user_code;
    const browserUrl = deviceCodeResponse.verification_uri_complete
      ?? deviceCodeResponse.verification_uri;

    // Step 2: Show auth UI panel with the user code
    await reportProgress("authentication", 1, 4, `Enter code: ${userCode}`);
    await openBrowserWithHtml(createAuthUiHtml(userCode));

    // Step 3: Open system browser with pre-filled URL
    console.log(`   Opening system browser for GitHub authorization...`);
    console.log(`   Enter code: ${userCode}`);
    await openSystemBrowser(browserUrl);

    // Step 4: Listen for cancel from auth UI
    let cancelled = false;
    const unlisten = await onEvent<object>("github:auth-cancel", () => {
      cancelled = true;
    });

    try {
      // Step 5: Poll for token
      await reportProgress("authentication", 2, 4, "Waiting for authorization...");
      const token = await waitForToken(
        deviceCodeResponse.device_code,
        deviceCodeResponse.interval,
        deviceCodeResponse.expires_in * 1000,
        () => cancelled
      );

      if (!token) {
        console.warn("   Authorization timed out or was denied");
        if (!cancelled) {
          await emitAuthState("error", "Authorization timed out or was denied");
          await closeBrowser().catch(() => {});
        }
        return false;
      }

      // Step 6: Success — notify auth UI and store token
      await emitAuthState("success");
      await reportProgress("authentication", 3, 4, "Storing credentials...");

      const stored = await storeToken(token);
      if (!stored) {
        console.warn("   Failed to store token");
      }

      await reportProgress("authentication", 4, 4, "Authenticated");
      console.log("   Successfully authenticated with GitHub");

      // Close auth UI panel
      await closeBrowser();

      return true;
    } finally {
      unlisten();
    }
  } catch (error) {
    console.error(`   Authentication failed: ${error}`);
    await emitAuthState("error", String(error));
    return false;
  }
}

// ============================================================================
// Auth UI
// ============================================================================

/**
 * Emit a state transition event to the auth UI panel
 */
async function emitAuthState(phase: "success" | "error", error?: string): Promise<void> {
  try {
    const w = window as unknown as {
      __TAURI__?: { event?: { emit: (name: string, payload: unknown) => Promise<void> } }
    };
    await w.__TAURI__?.event?.emit("github:auth-state", { phase, error });
  } catch {
    // Non-fatal — auth UI panel may already be closed
  }
}

/**
 * Generate HTML for the auth UI panel displayed during device flow
 */
export function createAuthUiHtml(userCode: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize moss on GitHub</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --surface-hover: #21262d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --success: #3fb950;
      --error: #f85149;
      --border: #30363d;
      --link: #58a6ff;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 24px;
    }

    .container { width: 100%; max-width: 400px; text-align: center; }

    .icon { width: 48px; height: 48px; margin-bottom: 16px; }

    h1 { font-size: 22px; font-weight: 600; margin-bottom: 8px; }

    .subtitle {
      color: var(--text-muted);
      font-size: 14px;
      margin-bottom: 24px;
    }

    .code-display {
      font-family: 'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 32px;
      letter-spacing: 0.15em;
      font-weight: 700;
      color: var(--text);
      padding: 20px 24px;
      background: var(--surface);
      border-radius: 8px;
      border: 1px solid var(--border);
      margin-bottom: 16px;
      user-select: all;
    }

    .copy-area { margin-bottom: 32px; }

    .btn-copy {
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 500;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      transition: background-color 0.15s;
    }

    .btn-copy:hover { background: var(--surface-hover); }
    .btn-copy.copied { color: var(--success); border-color: var(--success); }

    .status-area {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 24px;
      min-height: 24px;
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--border);
      border-top-color: var(--link);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    #status-text { color: var(--text-muted); font-size: 14px; }
    #status-text.success { color: var(--success); }
    #status-text.error { color: var(--error); }

    .btn-cancel {
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      transition: background-color 0.15s;
    }

    .btn-cancel:hover { background: var(--surface-hover); }

    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="container">
    <svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.475 2 2 6.475 2 12c0 4.42 2.865 8.17 6.84 9.49.5.09.68-.22.68-.48v-1.69c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02.8-.22 1.65-.33 2.5-.33.85 0 1.7.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48C19.14 20.17 22 16.42 22 12c0-5.525-4.475-10-10-10z" fill="#8b949e"/>
    </svg>

    <h1>Authorize moss on GitHub</h1>
    <p class="subtitle">Enter this code in your browser</p>

    <div class="code-display" id="user-code">${userCode}</div>

    <div class="copy-area">
      <button class="btn-copy" id="copy-btn">Copy code</button>
    </div>

    <div class="status-area">
      <div class="spinner" id="spinner"></div>
      <span id="status-text">Waiting for authorization...</span>
    </div>

    <button class="btn-cancel" id="cancel-btn">Cancel</button>
  </div>

  <script>
    const copyBtn = document.getElementById('copy-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const spinner = document.getElementById('spinner');
    const statusText = document.getElementById('status-text');
    const userCode = ${JSON.stringify(userCode)};

    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(userCode);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = userCode;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.textContent = 'Copy code';
        copyBtn.classList.remove('copied');
      }, 2000);
    });

    cancelBtn.addEventListener('click', () => {
      mossApi.emit('github:auth-cancel', {});
      mossApi.close();
    });

    const { event } = window.__TAURI__;
    event.listen('github:auth-state', (e) => {
      const { phase, error } = e.payload;
      if (phase === 'success') {
        spinner.classList.add('hidden');
        statusText.textContent = 'Authenticated!';
        statusText.className = 'success';
        cancelBtn.classList.add('hidden');
      } else if (phase === 'error') {
        spinner.classList.add('hidden');
        statusText.textContent = error || 'Authorization failed';
        statusText.className = 'error';
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Poll for access token until authorization is complete, cancelled, or timeout
 */
async function waitForToken(
  deviceCode: string,
  initialInterval: number,
  maxWaitMs: number,
  isCancelled: () => boolean = () => false
): Promise<string | null> {
  const startTime = Date.now();
  let interval = initialInterval;

  while (Date.now() - startTime < Math.min(maxWaitMs, MAX_POLL_TIME_MS)) {
    if (isCancelled()) return null;

    // Wait for the specified interval
    await sleep(interval * 1000);

    if (isCancelled()) return null;

    try {
      const response = await pollForToken(deviceCode, interval);

      if (response.access_token) {
        return response.access_token;
      }

      if (response.error === "authorization_pending") {
        // User hasn't authorized yet, keep polling
        continue;
      }

      if (response.error === "slow_down") {
        // GitHub wants us to slow down
        interval += 5;
        console.log(`   Slowing down, new interval: ${interval}s`);
        continue;
      }

      if (response.error === "expired_token") {
        console.warn("   Device code expired");
        return null;
      }

      if (response.error === "access_denied") {
        console.warn("   User denied authorization");
        return null;
      }

      // Unknown error
      console.error(`   Unexpected error: ${response.error}`);
      return null;
    } catch (error) {
      console.error(`   Poll error: ${error}`);
      // Continue polling on network errors
    }
  }

  console.warn("   Authorization timeout");
  return null;
}

// ============================================================================
// Exports for Testing
// ============================================================================

export { CLIENT_ID, REQUIRED_SCOPES };
