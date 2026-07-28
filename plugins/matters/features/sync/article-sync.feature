Feature: Article Sync from Matters
  As a content creator
  I want to sync my Matters articles locally
  So that I can edit them offline

  Background:
    Given a mock Tauri environment
    And an in-memory filesystem

  Scenario: Sync creates markdown files with frontmatter
    Given sample articles with titles and content
    When I sync articles to local files
    Then markdown files should be created in "article/" folder
    And each file should have frontmatter with title and date
    And each file should have the article content as markdown

  Scenario: Sync respects Chinese language preference
    Given a user with language preference "zh_hant"
    And sample articles with titles and content
    When I sync articles to local files
    Then articles should be in the localized folder
    And drafts folder should use localized name

  Scenario: Sync skips unchanged articles
    Given an existing article file with matching date
    And a remote article with the same date
    When I sync articles to local files
    Then the article should be skipped
    And the result should report 1 skipped

  Scenario: Sync updates newer remote articles
    Given an existing article file from yesterday
    And a remote article revised today
    When I sync articles to local files
    Then the article should be updated
    And the result should report 1 updated

  Scenario: Sync creates homepage with user profile
    Given a user profile with displayName "Test User"
    When I sync to local files
    Then index.md should be created at project root
    And the homepage should have the displayName as title

  Scenario: Sync handles collections in folder mode
    Given articles that each belong to one collection
    When I sync to local files
    Then collection folders should be created
    And articles should be placed inside their collection folder
    And collection index.md should be created with title and description
