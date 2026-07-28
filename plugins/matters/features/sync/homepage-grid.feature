Feature: Homepage Grid from Pinned Works
  As a content creator using Matters.town
  I want my homepage to show pinned works as a grid
  So that visitors see my featured content prominently

  Background:
    Given a mock Tauri environment
    And an in-memory filesystem

  Scenario: Homepage grid from pinned collections
    Given a user profile with pinned collections "Travel Notes" and "Tech Essays"
    And no existing homepage
    When I sync to local files
    Then index.md should contain ":::grid 3"
    And index.md should link to each pinned collection

  Scenario: Homepage grid with mixed pinned works
    Given a user profile with a pinned collection "My Series" and a pinned article "Featured Post"
    And no existing homepage
    When I sync to local files
    Then index.md should contain ":::grid 3"
    And index.md should link to both the collection and article

  Scenario: No grid when no pinned works
    Given a user profile with no pinned works
    And no existing homepage
    When I sync to local files
    Then index.md should NOT contain ":::grid"
    And index.md should contain the user bio

  Scenario: Skip homepage when already exists
    Given a user profile with pinned collections
    And an existing homepage with custom content
    When I sync to local files
    Then the existing homepage should be preserved
    And index.md should NOT contain ":::grid"

  Scenario: Collection order in folder mode
    Given a collection "My Series" with ordered articles "first", "second", "third"
    When I sync to local files
    Then the collection index.md should have an order field
    And the order should list articles as bare slugs
    And the order should match the Matters API ordering
