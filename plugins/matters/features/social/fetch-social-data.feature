@e2e @real-api
Feature: Fetch Social Data
  As a user, I want to download comments, donations, and appreciations
  So that I can display them on my static site

  Background:
    Given I am using the Matters test environment

  Scenario: Fetch comments for an article
    Given I have a test article shortHash
    When I fetch comments for the article
    Then I should receive an array of comments
    And each comment should have id, content, createdAt, and author

  Scenario: Fetch donations for an article
    Given I have a test article shortHash
    When I fetch donations for the article
    Then I should receive an array of donations
    And each donation should have id and sender details

  Scenario: Fetch appreciations for an article
    Given I have a test article shortHash
    When I fetch appreciations for the article
    Then I should receive an array of appreciations
    And each appreciation should have amount, createdAt, and sender

  Scenario: Save social data to .moss/social/matters.json
    Given I have fetched social data for an article
    When I save the social data
    Then the file .moss/social/matters.json should exist
    And it should contain the schemaVersion "1.0.0"
    And it should contain data for the article shortHash

  Scenario: Merge new social data with existing
    Given I have existing social data for an article
    And I fetch new social data
    When I merge the social data
    Then new items should be added
    And existing items should be preserved
    And no items should be duplicated
