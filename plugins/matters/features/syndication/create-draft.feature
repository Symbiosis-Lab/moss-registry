@e2e @real-api
Feature: Create Draft on Matters
  As a user, I want to syndicate my local articles to Matters
  So that I can publish to both platforms

  Background:
    Given I am authenticated with the Matters test environment

  Scenario: Create draft via API
    Given I have an article with title "E2E Test Article"
    And the article has content and tags
    When I create a draft on Matters
    Then a draft should be created with the correct title
    And the draft should have publishState "unpublished"
    And I should receive a draft ID

  Scenario: Fetch draft by ID
    Given I have created a draft on Matters
    When I fetch the draft by ID
    Then I should receive the draft details
    And the draft should have the correct title
    And the publishState should be present
