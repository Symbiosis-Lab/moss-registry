/**
 * Repository Setup Module (Consolidated)
 *
 * Feature 20: Smart Repo Setup
 * - Auto-creates {username}.github.io when available (no UI needed)
 * - Shows UI only when root is already taken
 *
 * This module replaces:
 * - repo-setup-browser.ts
 * - repo-create.ts
 * - repo-dialog.ts
 */

import { openBrowserWithHtml, closeBrowser, onEvent } from "@symbiosis-lab/moss-api";
import { reportProgress } from "./utils";
import { getToken, getTokenFromGit, storeToken } from "./token";
import { getAuthenticatedUser, checkRepoExists, createRepository, getRepoSshUrl } from "./github-api";
import { promptLogin, validateToken, hasRequiredScopes } from "./auth";
import { DEPLOY_HEARTBEAT_INTERVAL_MS } from "./constants";

/**
 * Result from the repo setup flow
 */
export interface RepoSetupResult {
  /** Repository name */
  name: string;
  /** SSH URL for git remote */
  sshUrl: string;
  /** Full name (owner/repo) */
  fullName: string;
}

/**
 * Value returned when user makes a deploy choice
 */
interface DeployChoice {
  action: "replace-root" | "custom-domain";
  repoName?: string;
}

/**
 * Ensure a GitHub repository exists for deployment
 *
 * This function:
 * 1. Ensures user is authenticated with GitHub
 * 2. Checks if {username}.github.io exists
 * 3. If available, auto-creates it (no UI needed)
 * 4. If taken, shows UI for user to enter custom repo name
 * 5. Returns the repo info
 *
 * @returns Repository info, or null if cancelled/failed
 */
export async function ensureGitHubRepo(): Promise<RepoSetupResult | null> {
  console.log("   Ensuring GitHub repository...");

  // Step 1: Ensure authentication
  const token = await ensureAuthenticated();
  if (!token) {
    return null;
  }

  // Step 2: Get authenticated user info
  let username: string;
  try {
    const user = await getAuthenticatedUser(token);
    username = user.login;
    console.log(`   Authenticated as ${username}`);
  } catch (error) {
    console.error(`   Failed to get user info: ${error}`);
    return null;
  }

  // Step 3: Check if {username}.github.io exists
  const rootRepoName = `${username}.github.io`;
  const rootExists = await checkRepoExists(username, rootRepoName, token);

  // Step 4: Auto-create or show deploy choice UI
  if (!rootExists) {
    // Root is available - auto-create (no UI needed!)
    return await createRootRepo(username, rootRepoName, token);
  } else {
    // Root is taken - show decision UI
    const choice = await showDeployChoiceUI(username, token);
    if (!choice) {
      await closeBrowser();
      return null;
    }

    if (choice.action === "replace-root") {
      const sshUrl = await getRepoSshUrl(username, rootRepoName, token);
      await closeBrowser();
      return { name: rootRepoName, sshUrl, fullName: `${username}/${rootRepoName}` };
    } else {
      const createdRepo = await createRepository(choice.repoName!, token, "Created with moss");
      await closeBrowser();
      return { name: createdRepo.name, sshUrl: createdRepo.sshUrl, fullName: createdRepo.fullName };
    }
  }
}

/**
 * Ensure user is authenticated, trying various sources
 */
async function ensureAuthenticated(): Promise<string | null> {
  // Try 1: Cached token
  let token = await getToken();
  if (token) {
    return token;
  }

  // Try 2: Git credential helper
  console.log("   No cached token, checking git credentials...");
  token = await getTokenFromGit();
  if (token) {
    const validation = await validateToken(token);
    if (validation.valid && hasRequiredScopes(validation.scopes || [])) {
      console.log(`   Using token from git credentials (${validation.user?.login})`);
      await storeToken(token);
      return token;
    } else {
      console.log("   Git credential token invalid or missing scopes");
    }
  }

  // Try 3: OAuth login
  console.log("   No valid credentials found, prompting login...");
  const loginSuccess = await promptLogin();
  if (!loginSuccess) {
    console.warn("   GitHub login cancelled or failed");
    return null;
  }

  token = await getToken();
  if (!token) {
    console.error("   Failed to get token after login");
    return null;
  }

  return token;
}

/**
 * Auto-create the root repo (no UI needed)
 */
async function createRootRepo(
  _username: string,
  repoName: string,
  token: string
): Promise<RepoSetupResult | null> {
  console.log(`   Auto-creating ${repoName} (will deploy to root URL)...`);

  try {
    const createdRepo = await createRepository(repoName, token, "Created with moss");
    console.log(`   Repository created: ${createdRepo.htmlUrl}`);

    return {
      name: createdRepo.name,
      sshUrl: createdRepo.sshUrl,
      fullName: createdRepo.fullName,
    };
  } catch (error) {
    console.error(`   Failed to create repository: ${error}`);
    return null;
  }
}

/**
 * Show browser with HTML and wait for form submission with progress heartbeats.
 *
 * Uses the new manual browser control pattern:
 * - openBrowserWithHtml() to display content
 * - onEvent() to listen for custom events
 * - Caller is responsible for calling closeBrowser() when done
 *
 * Sends progress heartbeats every 30 seconds to prevent inactivity timeout.
 *
 * @param html - The HTML content for the form
 * @param eventName - Custom event name to listen for (e.g., "github:repo-created")
 * @param progressMessage - Message to show during heartbeat updates
 * @param timeoutMs - Maximum time to wait (default: 300000ms / 5 minutes)
 * @returns Form result or null if cancelled/timeout/error
 */
async function showBrowserWithProgress<T>(
  html: string,
  eventName: string,
  progressMessage: string,
  timeoutMs: number = 300000
): Promise<T | null> {
  // Start heartbeat interval — must be < progress panel STALE_TIMEOUT_MS (15s)
  const heartbeat = setInterval(async () => {
    await reportProgress("setup", 0, 6, progressMessage);
  }, DEPLOY_HEARTBEAT_INTERVAL_MS);

  let unlisten: (() => void) | null = null;

  try {
    // Open browser with HTML
    await openBrowserWithHtml(html);

    // Wait for form submission or timeout
    return await Promise.race([
      // Wait for event
      new Promise<T>(async (resolve) => {
        unlisten = await onEvent<T>(eventName, (payload) => {
          resolve(payload);
          return payload;
        });
      }),
      // Timeout
      new Promise<T | null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch (error) {
    console.error(`   Form display error: ${error}`);
    return null;
  } finally {
    // Always clear interval and unlisten from event
    clearInterval(heartbeat);
    if (unlisten != null) {
      (unlisten as () => void)();
    }
  }
}

/**
 * Show deploy choice UI when root repo is already taken.
 * Presents two options: "Replace it" or "Use a custom domain".
 */
async function showDeployChoiceUI(
  username: string,
  token: string
): Promise<DeployChoice | null> {
  console.log("   Root repo already exists, showing deploy choice UI...");

  const html = createDeployChoiceHtml(username, token);
  return await showBrowserWithProgress<DeployChoice>(
    html,
    "github:deploy-choice",
    "Setting up GitHub repository...",
    300000
  );
}

/**
 * Generate the HTML for the deploy choice browser UI.
 * Two-card layout: "Replace it" (deploy to existing root) or
 * "Use a custom domain" (create a project repo).
 */
function createDeployChoiceHtml(username: string, token: string): string {
  const rootRepoName = `${username}.github.io`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitHub Repository Setup</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --surface-hover: #21262d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --primary: #238636;
      --primary-hover: #2ea043;
      --success: #3fb950;
      --error: #f85149;
      --warning: #d29922;
      --border: #30363d;
      --link: #58a6ff;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

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

    .container {
      width: 100%;
      max-width: 480px;
    }

    .icon {
      width: 48px;
      height: 48px;
      margin-bottom: 16px;
    }

    h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 14px;
      margin-bottom: 24px;
      line-height: 1.5;
    }

    .info-box {
      padding: 12px 16px;
      background: rgba(210, 153, 34, 0.1);
      border: 1px solid var(--warning);
      border-radius: 6px;
      font-size: 13px;
      color: var(--warning);
      margin-bottom: 24px;
      line-height: 1.5;
    }

    .info-box code {
      background: rgba(210, 153, 34, 0.2);
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
      transition: border-color 0.15s;
    }

    .card:hover {
      border-color: var(--text-muted);
    }

    .card h2 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 6px;
    }

    .card p {
      color: var(--text-muted);
      font-size: 13px;
      line-height: 1.5;
      margin-bottom: 16px;
    }

    .card code {
      background: rgba(88, 166, 255, 0.1);
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
      color: var(--link);
    }

    .form-group {
      margin-bottom: 16px;
    }

    label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 8px;
    }

    .input-wrapper {
      display: flex;
      align-items: center;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: hidden;
      transition: border-color 0.15s;
    }

    .input-wrapper:focus-within {
      border-color: var(--link);
    }

    .input-wrapper.error {
      border-color: var(--error);
    }

    .input-wrapper.success {
      border-color: var(--success);
    }

    .prefix {
      padding: 10px 0 10px 12px;
      color: var(--text-muted);
      font-size: 14px;
      white-space: nowrap;
    }

    input[type="text"] {
      flex: 1;
      padding: 10px 12px 10px 4px;
      font-size: 14px;
      background: transparent;
      border: none;
      color: var(--text);
      outline: none;
    }

    input[type="text"]::placeholder {
      color: var(--text-muted);
    }

    .status {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      font-size: 13px;
      min-height: 20px;
    }

    .status.checking {
      color: var(--text-muted);
    }

    .status.available {
      color: var(--success);
    }

    .status.taken,
    .status.invalid {
      color: var(--error);
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--border);
      border-top-color: var(--link);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    button {
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      transition: background-color 0.15s;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-primary {
      background: var(--primary);
      color: white;
      width: 100%;
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--primary-hover);
    }

    .btn-secondary {
      background: var(--surface-hover);
      color: var(--text);
      border: 1px solid var(--border);
      width: 100%;
    }

    .btn-secondary:hover:not(:disabled) {
      background: var(--border);
    }

    .cancel-row {
      text-align: center;
      margin-top: 16px;
    }

    .cancel-link {
      color: var(--text-muted);
      font-size: 13px;
      cursor: pointer;
      background: none;
      border: none;
      text-decoration: underline;
      padding: 0;
      width: auto;
    }

    .cancel-link:hover {
      color: var(--text);
    }
  </style>
</head>
<body>
  <div class="container">
    <svg class="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.475 2 2 6.475 2 12c0 4.42 2.865 8.17 6.84 9.49.5.09.68-.22.68-.48v-1.69c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02.8-.22 1.65-.33 2.5-.33.85 0 1.7.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48C19.14 20.17 22 16.42 22 12c0-5.525-4.475-10-10-10z" fill="#8b949e"/>
    </svg>

    <h1>Deploy your site</h1>
    <p class="subtitle">
      <code>${rootRepoName}</code> already exists. How would you like to deploy?
    </p>

    <!-- Card 1: Replace root -->
    <div class="card" id="card-replace">
      <h2>Replace it</h2>
      <p>
        Deploy to your existing <code>${rootRepoName}</code> repository.
        Your site will be at <strong>${username}.github.io/</strong>
      </p>
      <button class="btn-primary" id="replace-btn">Deploy to ${username}.github.io</button>
    </div>

    <!-- Card 2: Custom domain / project repo -->
    <div class="card" id="card-custom">
      <h2>Use a custom domain</h2>
      <p>
        Create a new repository and set up a custom domain later.
        Your site will be at <strong>${username}.github.io/<em>repo-name</em>/</strong> until the domain is configured.
      </p>

      <div class="form-group">
        <label for="repo-name">Repository name</label>
        <div class="input-wrapper" id="input-wrapper">
          <span class="prefix">github.com/${username}/</span>
          <input type="text" id="repo-name" placeholder="my-website"
                 autocomplete="off" autocorrect="off" spellcheck="false">
        </div>
        <div class="status" id="status"></div>
      </div>

      <button class="btn-secondary" id="custom-btn" disabled>Create & Deploy</button>
    </div>

    <div class="cancel-row">
      <button class="cancel-link" id="cancel-btn">Cancel</button>
    </div>
  </div>

  <script>
    const token = '${token}';

    const input = document.getElementById('repo-name');
    const inputWrapper = document.getElementById('input-wrapper');
    const status = document.getElementById('status');
    const replaceBtn = document.getElementById('replace-btn');
    const customBtn = document.getElementById('custom-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    let checkTimeout = null;
    let isAvailable = false;
    let currentName = '';

    const validNameRegex = /^[a-zA-Z0-9._-]+$/;

    function setStatus(type, message) {
      status.className = 'status ' + type;

      if (type === 'checking') {
        status.innerHTML = '<div class="spinner"></div>' + message;
      } else if (type === 'available') {
        status.innerHTML = '<span>✓</span> ' + message;
      } else if (type === 'taken' || type === 'invalid') {
        status.innerHTML = '<span>✗</span> ' + message;
      } else {
        status.innerHTML = message;
      }

      inputWrapper.className = 'input-wrapper ' +
        (type === 'available' ? 'success' :
         (type === 'taken' || type === 'invalid') ? 'error' : '');

      customBtn.disabled = type !== 'available';
      isAvailable = type === 'available';
    }

    function validateName(name) {
      if (!name) {
        setStatus('', '');
        return false;
      }

      if (name.startsWith('.')) {
        setStatus('invalid', 'Name cannot start with a period');
        return false;
      }

      if (!validNameRegex.test(name)) {
        setStatus('invalid', 'Only letters, numbers, hyphens, underscores, and periods allowed');
        return false;
      }

      if (name.length > 100) {
        setStatus('invalid', 'Name is too long (max 100 characters)');
        return false;
      }

      return true;
    }

    async function checkAvailability(name) {
      if (!validateName(name)) return;

      currentName = name;
      setStatus('checking', 'Checking availability...');

      try {
        const response = await fetch('https://api.github.com/repos/${username}/' + name, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': 'Bearer ' + token
          }
        });

        if (name !== currentName) return;

        if (response.status === 404) {
          setStatus('available', 'Name is available');
        } else if (response.ok) {
          setStatus('taken', 'Repository already exists');
        } else {
          setStatus('invalid', 'Error checking availability');
        }
      } catch (error) {
        if (name !== currentName) return;
        setStatus('invalid', 'Error checking availability');
      }
    }

    input.addEventListener('input', (e) => {
      const name = e.target.value.trim();

      if (checkTimeout) {
        clearTimeout(checkTimeout);
      }

      if (!validateName(name)) return;

      checkTimeout = setTimeout(() => {
        checkAvailability(name);
      }, 300);
    });

    replaceBtn.addEventListener('click', () => {
      replaceBtn.disabled = true;
      replaceBtn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:8px"><span class="spinner"></span>Connecting...</span>';
      mossApi.emit('github:deploy-choice', { action: 'replace-root' });
    });

    customBtn.addEventListener('click', () => {
      if (!isAvailable) return;
      const name = input.value.trim();
      customBtn.disabled = true;
      customBtn.innerHTML = '<span style="display:flex;align-items:center;justify-content:center;gap:8px"><span class="spinner"></span>Creating...</span>';
      mossApi.emit('github:deploy-choice', { action: 'custom-domain', repoName: name });
    });

    cancelBtn.addEventListener('click', () => {
      mossApi.close();
    });
  </script>
</body>
</html>`;
}
