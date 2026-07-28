Feature: GitHub Deployer Validation
  As a user deploying to GitHub Pages
  I want clear error messages when configuration is incorrect
  So I can fix issues and deploy successfully

  Scenario: Deploy from non-git directory
    Given the directory is not a git repository
    When I attempt to deploy
    Then the deployment should fail
    And the error should indicate setup was cancelled

  Scenario: Deploy without any git remote
    Given the directory is a git repository
    And no git remote is configured
    When I attempt to deploy
    Then the deployment should fail
    And the error should mention "No git remote configured"
    And the error should include instructions to add a GitHub remote

  Scenario: Deploy with non-GitHub remote triggers setup
    Given the directory is a git repository
    And the git remote is not a GitHub URL
    When I attempt to deploy
    Then the deployment should fail
    And the error should indicate setup was cancelled

  Scenario: Deploy with empty site directory
    Given the directory is a git repository
    And the site directory is empty
    When I attempt to deploy
    Then the deployment should fail
    And the error should mention that the site needs to be built

  Scenario: Successful deployment with SSH remote
    Given the directory is a git repository
    And the git remote is "git@github.com:testuser/testrepo.git"
    And the site is built with files in ".moss/build/site/"
    And the GitHub Actions workflow already exists
    When I attempt to deploy
    Then the deployment should succeed
    And the deployment URL should be "https://testuser.github.io/testrepo"

  Scenario: First-time deployment creates workflow
    Given the directory is a git repository
    And the git remote is "git@github.com:user/repo.git"
    And the site is built with files in ".moss/build/site/"
    And the GitHub Actions workflow does not exist
    When I attempt to deploy
    Then the deployment should succeed
    And the result should indicate first-time setup
