/**
 * Ethereum Wallet Authentication for E2E Testing
 *
 * Uses Ethereum wallet signature to authenticate with Matters.icu (test environment).
 * This allows programmatic login without email verification.
 *
 * Authentication Flow (EIP-4361 Sign-In with Ethereum):
 * 1. Generate signing message with wallet address
 * 2. Sign the message with private key
 * 3. Submit signature to login/signup
 * 4. Receive auth token
 *
 * Environment Variables:
 * - MATTERS_TEST_WALLET_PRIVATE_KEY: Ethereum private key for test account
 * - MATTERS_TEST_ENDPOINT: GraphQL endpoint (default: https://server.matters.icu/graphql)
 */

import { graphqlQuery } from "./api-client";

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_ENDPOINT = "https://server.matters.icu/graphql";

function getEnv(key: string): string | undefined {
  return process.env[key];
}

// ============================================================================
// GraphQL Mutations
// ============================================================================

const GENERATE_SIGNING_MESSAGE_MUTATION = `
mutation GenerateSigningMessage($input: GenerateSigningMessageInput!) {
  generateSigningMessage(input: $input) {
    nonce
    purpose
    signingMessage
    createdAt
    expiredAt
  }
}
`;

const WALLET_LOGIN_MUTATION = `
mutation WalletLogin($input: WalletLoginInput!) {
  walletLogin(input: $input) {
    auth
    token
    type
    user {
      id
      userName
      displayName
    }
  }
}
`;

// ============================================================================
// Types
// ============================================================================

interface GenerateSigningMessageResponse {
  generateSigningMessage: {
    nonce: string;
    purpose: string;
    signingMessage: string;
    createdAt: string;
    expiredAt: string;
  };
}

interface WalletLoginResponse {
  walletLogin: {
    auth: boolean;
    token: string | null;
    type: "Login" | "Signup" | "LinkAccount";
    user: {
      id: string;
      userName: string;
      displayName: string;
    } | null;
  };
}

export interface WalletAuthResult {
  token: string;
  user: {
    id: string;
    userName: string;
    displayName: string;
  };
  type: "Login" | "Signup" | "LinkAccount";
}

// ============================================================================
// Wallet Utilities
// ============================================================================

/**
 * Simple Ethereum signing implementation using Web Crypto API
 * Note: For production, use ethers.js or viem
 */

// keccak256 hash function (simplified for personal_sign)
// In real implementation, use ethers.js or viem
async function signMessage(message: string, privateKey: string): Promise<string> {
  // For now, we'll use dynamic import of ethers since it's commonly available
  // In CI, we'll need to ensure ethers is installed as a dev dependency
  try {
    // Try to use ethers.js if available
    const { Wallet } = await import("ethers");
    const wallet = new Wallet(privateKey);
    return wallet.signMessage(message);
  } catch {
    throw new Error(
      "ethers.js is required for wallet signing. Install with: npm install --save-dev ethers"
    );
  }
}

/**
 * Derive Ethereum address from private key
 */
async function getAddressFromPrivateKey(privateKey: string): Promise<string> {
  try {
    const { Wallet } = await import("ethers");
    const wallet = new Wallet(privateKey);
    return wallet.address;
  } catch {
    throw new Error(
      "ethers.js is required for address derivation. Install with: npm install --save-dev ethers"
    );
  }
}

// ============================================================================
// Authentication Functions
// ============================================================================

/**
 * Authenticate with Matters using Ethereum wallet
 *
 * @param privateKey - Ethereum private key (hex string, with or without 0x prefix)
 * @param endpoint - GraphQL endpoint (default: matters.icu test environment)
 * @returns Authentication result with token and user info
 */
export async function walletLogin(
  privateKey?: string,
  endpoint = DEFAULT_ENDPOINT
): Promise<WalletAuthResult> {
  // Get private key from param or environment
  const key = privateKey || getEnv("MATTERS_TEST_WALLET_PRIVATE_KEY");
  if (!key) {
    throw new Error(
      "Private key required. Pass as parameter or set MATTERS_TEST_WALLET_PRIVATE_KEY environment variable."
    );
  }

  // Normalize private key (ensure 0x prefix)
  const normalizedKey = key.startsWith("0x") ? key : `0x${key}`;

  // Step 1: Get wallet address
  const address = await getAddressFromPrivateKey(normalizedKey);
  console.log(`🔐 Authenticating with wallet: ${address}`);

  // Step 2: Generate signing message
  console.log("   Generating signing message...");
  const signingData = await graphqlQuery<GenerateSigningMessageResponse>(
    GENERATE_SIGNING_MESSAGE_MUTATION,
    {
      input: {
        address,
        purpose: "login",
      },
    },
    endpoint
  );

  const { nonce, signingMessage } = signingData.generateSigningMessage;
  console.log(`   Nonce: ${nonce}`);

  // Step 3: Sign the message
  console.log("   Signing message...");
  const signature = await signMessage(signingMessage, normalizedKey);
  console.log(`   Signature: ${signature.substring(0, 20)}...`);

  // Step 4: Login with signature
  console.log("   Submitting login...");
  const loginData = await graphqlQuery<WalletLoginResponse>(
    WALLET_LOGIN_MUTATION,
    {
      input: {
        ethAddress: address,
        nonce,
        signature,
        signedMessage: signingMessage,
      },
    },
    endpoint
  );

  const { auth, token, type, user } = loginData.walletLogin;

  if (!auth || !token || !user) {
    throw new Error("Login failed: auth returned false or no token received");
  }

  console.log(`   ✅ ${type}: @${user.userName}`);

  return {
    token,
    user,
    type,
  };
}

/**
 * Create an authenticated GraphQL query function
 *
 * @param token - Authentication token from walletLogin
 * @param endpoint - GraphQL endpoint
 * @returns Function that makes authenticated GraphQL queries
 */
export function createAuthenticatedClient(
  token: string,
  endpoint = DEFAULT_ENDPOINT
) {
  return async function authenticatedQuery<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-access-token": token,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    interface GraphQLResponse<T> {
      data?: T;
      errors?: Array<{ message: string }>;
    }

    const result: GraphQLResponse<T> = await response.json();

    if (result.errors && result.errors.length > 0) {
      throw new Error(`GraphQL error: ${result.errors[0].message}`);
    }

    if (!result.data) {
      throw new Error("No data returned from GraphQL query");
    }

    return result.data;
  };
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Get or create a test account
 *
 * If the wallet has never been used, it will create a new account (Signup).
 * Otherwise, it will log in to the existing account (Login).
 */
export async function getTestAccount(
  endpoint = DEFAULT_ENDPOINT
): Promise<WalletAuthResult> {
  return walletLogin(undefined, endpoint);
}

/**
 * Generate a new random wallet for testing
 *
 * Returns the private key and address.
 * Note: The account won't exist on Matters until first login.
 */
export async function generateTestWallet(): Promise<{
  privateKey: string;
  address: string;
}> {
  try {
    const { Wallet } = await import("ethers");
    const wallet = Wallet.createRandom();
    return {
      privateKey: wallet.privateKey,
      address: wallet.address,
    };
  } catch {
    throw new Error(
      "ethers.js is required. Install with: npm install --save-dev ethers"
    );
  }
}
