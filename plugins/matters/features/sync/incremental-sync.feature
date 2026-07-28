@e2e @real-api
Feature: Incremental Article Sync
  As a user, I want to sync only articles modified since my last sync
  So that I save bandwidth and time

  Background:
    Given I am using the Matters test environment
    And I have a test user with articles

  Scenario: First sync fetches all articles and saves timestamp
    Given I have no previous sync timestamp
    When I run the sync process
    Then all articles should be fetched
    And the config should contain a lastSyncedAt timestamp

  Scenario: Subsequent sync only fetches newer articles
    Given I have a lastSyncedAt timestamp from 1 hour ago
    And the test user has multiple articles
    When I run the sync process
    Then only recently modified articles should be fetched
    And the lastSyncedAt timestamp should be updated

  Scenario: Sync skips unchanged articles when no modifications
    Given I have synced all articles recently
    And no articles have been modified since
    When I run the sync process again
    Then 0 articles should be fetched
    And existing local files should remain unchanged
