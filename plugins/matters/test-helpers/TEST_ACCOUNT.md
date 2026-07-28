> **Warning:** This file documents how to configure test credentials. NEVER commit a real wallet private key. Use a throwaway test account funded only with disposable test tokens.

# Matters Test Account Setup

This document describes how to set up a test account for E2E testing on Matters.icu (test environment).

## Overview

The Matters plugin uses Ethereum wallet authentication for E2E tests. This allows programmatic login without requiring email verification, making it suitable for CI/CD environments.

## Environment

- **Test Server**: `https://server.matters.icu/graphql`
- **Test Website**: `https://matters.icu`
- **Authentication**: Ethereum wallet (EIP-4361 Sign-In with Ethereum)

## Setting Up a Test Account

### 1. Generate a Test Wallet

You can generate a new Ethereum wallet using ethers.js:

```typescript
import { Wallet } from "ethers";

const wallet = Wallet.createRandom();
console.log("Private Key:", wallet.privateKey);
console.log("Address:", wallet.address);
```

Or using the command line with Foundry:

```bash
cast wallet new
```

### 2. Store the Private Key

Add the private key to your GitHub repository secrets:

1. Go to your repository Settings → Secrets and variables → Actions
2. Create a new secret: `MATTERS_TEST_WALLET_PRIVATE_KEY`
3. Paste the private key (with or without `0x` prefix)

For local development, add to your `.env` file (never commit this!):

```bash
MATTERS_TEST_WALLET_PRIVATE_KEY=0x...your-private-key...
```

### 3. First Login Creates Account

The first time you authenticate with the wallet, Matters will automatically create a new account. Subsequent logins will use the existing account.

## Usage in Tests

### Basic Authentication

```typescript
import { walletLogin, createAuthenticatedClient } from "./wallet-auth";

// Login with environment variable
const auth = await walletLogin();
console.log("Logged in as:", auth.user.userName);

// Create authenticated client
const query = createAuthenticatedClient(auth.token);

// Make authenticated requests
const result = await query(`
  query {
    viewer {
      id
      userName
    }
  }
`);
```

### With Custom Endpoint

```typescript
const auth = await walletLogin(
  process.env.MATTERS_TEST_WALLET_PRIVATE_KEY,
  "https://server.matters.icu/graphql"
);
```

## CI Configuration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      MATTERS_TEST_WALLET_PRIVATE_KEY: ${{ secrets.MATTERS_TEST_WALLET_PRIVATE_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm run test:e2e
```

## Security Notes

1. **Never commit private keys** to the repository
2. Use GitHub Secrets for CI/CD
3. The test wallet should only hold test assets
4. Consider using a dedicated test wallet, not a production wallet
5. The test environment (matters.icu) is separate from production (matters.town)

## Troubleshooting

### "ethers.js is required"

Install ethers as a dev dependency:

```bash
npm install --save-dev ethers
```

### "Login failed: auth returned false"

- Verify the private key is correct
- Check if the endpoint is reachable
- Ensure the signing message hasn't expired (10 minute validity)

### Rate Limiting

The Matters API has rate limits. If you see 429 errors, wait a few minutes before retrying.

## Test Data Considerations

When writing tests that create content (articles, comments, etc.):

1. Use descriptive titles with test identifiers (e.g., `[TEST] My Article`)
2. Clean up test data after tests when possible
3. Consider using unique identifiers to avoid conflicts between parallel test runs

## Related Files

- [wallet-auth.ts](./wallet-auth.ts) - Wallet authentication implementation
- [api-client.ts](./api-client.ts) - GraphQL client for public queries
