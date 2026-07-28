@e2e @real-api
Feature: Wallet Authentication
  As a developer, I want to authenticate with Ethereum wallet
  So that I can run e2e tests without email verification

  Background:
    Given I am using the Matters test environment

  Scenario: Login with valid wallet signature
    Given I have a valid Ethereum private key
    When I complete the wallet login flow
    Then I should receive an auth token
    And I should receive my user info
    And the type should be "Login" or "Signup"

  Scenario: Generate signing message
    Given I have a valid Ethereum address
    When I request a signing message for login
    Then I should receive a nonce
    And I should receive a signingMessage
    And the message should contain the address

  Scenario: Create authenticated client
    Given I have completed wallet login
    And I have an auth token
    When I create an authenticated client
    Then the client should be able to make authenticated requests
