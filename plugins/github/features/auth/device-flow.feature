Feature: GitHub OAuth Device Flow Authentication
  As a user deploying to GitHub Pages
  I want to authenticate via browser
  So I can push without configuring git credentials manually

  Scenario: Request device code from GitHub
    Given no existing GitHub credentials
    When I initiate the device flow authentication
    Then I should receive a device code response
    And the response should include user_code, verification_uri, and interval

  Scenario: Poll for access token after authorization
    Given a valid device code
    And the user has authorized the application
    When I poll for the access token
    Then I should receive an access token
    And the token should have repo and workflow scopes

  Scenario: Handle authorization pending state
    Given a valid device code
    And the user has not yet authorized
    When I poll for the access token
    Then I should receive authorization_pending error
    And I should continue polling

  Scenario: Store token in git credential helper
    Given a valid access token
    When I store the token
    Then the token should be stored successfully
    And I should be able to retrieve the token

  Scenario: Handle expired device code
    Given a device code that has expired
    When I poll for the access token
    Then I should receive an expired_token error

  Scenario: Validate token with GitHub API
    Given a valid access token
    When I validate the token
    Then I should receive user information
    And the scopes should include repo and workflow
