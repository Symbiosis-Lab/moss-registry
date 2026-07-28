/**
 * Plugin-specific type definitions for the GitHub Pages Deployer Plugin
 *
 * Common types (DeployContext, HookResult, PluginMessage, etc.) are imported
 * from @symbiosis-lab/moss-api.
 */

// Re-export SDK types for convenience
export type {
  DeployContext,
  ConfigureDomainContext,
  HookResult,
  DeploymentInfo,
  ProjectInfo,
  PluginMessage,
  DnsTarget,
  DnsRecord,
} from "@symbiosis-lab/moss-api";

// ============================================================================
// GitHub OAuth Device Flow Types
// ============================================================================

/**
 * Response from GitHub's device code endpoint
 * POST https://github.com/login/device/code
 */
export interface DeviceCodeResponse {
  /** The device verification code (used for polling) */
  device_code: string;
  /** The user code to display to the user */
  user_code: string;
  /** The URL where user enters the code */
  verification_uri: string;
  /** Pre-filled URL with user_code embedded (user just clicks "Continue") */
  verification_uri_complete?: string;
  /** Seconds until the codes expire */
  expires_in: number;
  /** Minimum seconds between poll requests */
  interval: number;
}

/**
 * Response from GitHub's access token endpoint
 * POST https://github.com/login/oauth/access_token
 */
export interface TokenResponse {
  /** The access token (present on success) */
  access_token?: string;
  /** Token type, usually "bearer" */
  token_type?: string;
  /** Granted scopes */
  scope?: string;
  /** Error code (present on failure) */
  error?: string;
  /** Human-readable error description */
  error_description?: string;
}

/**
 * GitHub user response from /user endpoint
 * Used to validate tokens
 */
export interface GitHubUser {
  login: string;
  id: number;
  name?: string;
  email?: string;
}

/**
 * Authentication state for the plugin
 */
export interface AuthState {
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** GitHub username if authenticated */
  username?: string;
  /** Token scopes if authenticated */
  scopes?: string[];
}

/**
 * Configuration for the auth module
 */
export interface AuthConfig {
  /** GitHub OAuth App Client ID */
  clientId: string;
  /** Required OAuth scopes */
  scopes: string[];
}
