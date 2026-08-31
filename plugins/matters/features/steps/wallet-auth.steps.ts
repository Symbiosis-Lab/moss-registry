import { loadFeature, describeFeature } from "@amiceli/vitest-cucumber";
import { describe, expect, it } from "vitest";
import {
  walletLogin,
  createAuthenticatedClient,
  type WalletAuthResult,
} from "../../test-helpers/wallet-auth";
import { graphqlQuery } from "../../test-helpers/api-client";

const feature = await loadFeature("features/auth/wallet-auth.feature");

const TEST_ENDPOINT = "https://server.matters.icu/graphql";

// Live suite: every scenario signs in against server.matters.icu with the
// shared test wallet (test-helpers/TEST_ACCOUNT.md). Without the key this file
// used to generate a RANDOM wallet and still hit the network — which can
// create a stray account on staging and passes green while proving nothing —
// so an unset key now skips the whole feature loudly instead.
const TEST_WALLET_KEY = process.env.MATTERS_TEST_WALLET_PRIVATE_KEY ?? "";

if (!TEST_WALLET_KEY) {
  describe.skip("Wallet authentication against matters.icu", () => {
    it("requires MATTERS_TEST_WALLET_PRIVATE_KEY (see test-helpers/TEST_ACCOUNT.md)", () => {});
  });
}

// GraphQL queries for testing
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

const VIEWER_QUERY = `
query Viewer {
  viewer {
    id
    userName
    displayName
  }
}
`;

interface GenerateSigningMessageResponse {
  generateSigningMessage: {
    nonce: string;
    purpose: string;
    signingMessage: string;
    createdAt: string;
    expiredAt: string;
  };
}

interface ViewerResponse {
  viewer: {
    id: string;
    userName: string;
    displayName: string;
  } | null;
}

if (TEST_WALLET_KEY)
  describeFeature(feature, ({ Scenario, Background }) => {
    // Test state
    let testAddress: string;
    let signingMessageResponse: GenerateSigningMessageResponse["generateSigningMessage"];
    let authResult: WalletAuthResult;
    let authToken: string;
    let authenticatedQuery: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

    Background(({ Given }) => {
      Given("I am using the Matters test environment", () => {
        // Test endpoint is already set to matters.icu
      });
    });

    Scenario("Login with valid wallet signature", ({ Given, When, Then, And }) => {
      Given("I have a valid Ethereum private key", () => {
        expect(TEST_WALLET_KEY.length).toBeGreaterThan(0);
      });

      When("I complete the wallet login flow", async () => {
        authResult = await walletLogin(TEST_WALLET_KEY, TEST_ENDPOINT);
      });

      Then("I should receive an auth token", () => {
        expect(authResult.token).toBeDefined();
        expect(authResult.token.length).toBeGreaterThan(0);
      });

      And("I should receive my user info", () => {
        expect(authResult.user).toBeDefined();
        expect(authResult.user.id).toBeDefined();
        expect(authResult.user.userName).toBeDefined();
      });

      And('the type should be "Login" or "Signup"', () => {
        expect(["Login", "Signup", "LinkAccount"]).toContain(authResult.type);
      });
    });

    Scenario("Generate signing message", ({ Given, When, Then, And }) => {
      Given("I have a valid Ethereum address", async () => {
        const { Wallet } = await import("ethers");
        const wallet = new Wallet(
          TEST_WALLET_KEY.startsWith("0x") ? TEST_WALLET_KEY : `0x${TEST_WALLET_KEY}`
        );
        testAddress = wallet.address;
      });

      When("I request a signing message for login", async () => {
        const response = await graphqlQuery<GenerateSigningMessageResponse>(
          GENERATE_SIGNING_MESSAGE_MUTATION,
          {
            input: {
              address: testAddress,
              purpose: "login",
            },
          },
          TEST_ENDPOINT
        );

        signingMessageResponse = response.generateSigningMessage;
      });

      Then("I should receive a nonce", () => {
        expect(signingMessageResponse.nonce).toBeDefined();
        expect(signingMessageResponse.nonce.length).toBeGreaterThan(0);
      });

      And("I should receive a signingMessage", () => {
        expect(signingMessageResponse.signingMessage).toBeDefined();
        expect(signingMessageResponse.signingMessage.length).toBeGreaterThan(0);
      });

      And("the message should contain the address", () => {
        // EIP-4361 signing messages include the wallet address
        expect(signingMessageResponse.signingMessage.toLowerCase()).toContain(
          testAddress.toLowerCase()
        );
      });
    });

    Scenario("Create authenticated client", ({ Given, When, Then, And }) => {
      Given("I have completed wallet login", async () => {
        authResult = await walletLogin(TEST_WALLET_KEY, TEST_ENDPOINT);
      });

      And("I have an auth token", () => {
        authToken = authResult.token;
        expect(authToken).toBeDefined();
        expect(authToken.length).toBeGreaterThan(0);
      });

      When("I create an authenticated client", () => {
        authenticatedQuery = createAuthenticatedClient(authToken, TEST_ENDPOINT);
      });

      Then("the client should be able to make authenticated requests", async () => {
        // Make an authenticated query to verify the client works
        const response = await authenticatedQuery<ViewerResponse>(VIEWER_QUERY);

        expect(response.viewer).not.toBeNull();
        expect(response.viewer!.id).toBeDefined();
        expect(response.viewer!.userName).toBe(authResult.user.userName);
      });
    });
  });
