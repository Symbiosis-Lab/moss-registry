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

  Scenario: Draft includes canonical link
    Given I have an article with canonical URL "https://my-site.com/test-article"
    And add_canonical_link is enabled
    When I create a draft on Matters
    Then the draft content should contain the canonical URL
    And it should be formatted as a link at the end

  Scenario: Fetch draft by ID
    Given I have created a draft on Matters
    When I fetch the draft by ID
    Then I should receive the draft details
    And the draft should have the correct title
    And the publishState should be present

  Scenario: Skip already syndicated articles
    Given I have an article with syndicated URL for Matters
    When I check if the article should be syndicated
    Then the article should be skipped
    And no new draft should be created
