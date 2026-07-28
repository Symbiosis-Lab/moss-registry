Feature: Self-correcting reference updates
  As a Matters user
  I want image references to be automatically updated after download
  So that my markdown files reference local assets correctly

  Scenario: Updates references when assets already exist
    Given a mock Tauri environment
    And an in-memory filesystem
    And a markdown file with remote image URLs
    And the assets already exist locally
    When I run downloadMediaAndUpdate
    Then no downloads should occur
    And all image references should be updated to local paths

  Scenario: Downloads and updates in single pass
    Given a mock Tauri environment
    And an in-memory filesystem
    And a markdown file with remote image URLs
    And no assets exist locally
    When I run downloadMediaAndUpdate
    Then all images should be downloaded
    And all image references should be updated to local paths

  Scenario: Resumes correctly after interruption
    Given a mock Tauri environment
    And an in-memory filesystem
    And a markdown file with multiple remote image URLs
    And some assets already exist locally
    When I run downloadMediaAndUpdate
    Then only missing assets should be downloaded
    And all image references should be updated to local paths

  Scenario: Handles cross-CDN URLs with same UUID
    Given a mock Tauri environment
    And an in-memory filesystem
    And a markdown file with cover and body images using different CDNs
    And both URLs contain the same UUID
    When I run downloadMediaAndUpdate
    Then only one download should occur
    And both cover and body references should point to the same local file

  Scenario: Idempotent operation
    Given a mock Tauri environment
    And an in-memory filesystem
    And a markdown file with local image references
    And all assets exist locally
    When I run downloadMediaAndUpdate twice
    Then no downloads should occur
    And the file should not be modified

  # ============================================================================
  # Incremental Write Behavior Tests
  # These tests verify the core design principle: files are written immediately
  # after processing, not batched at the end. This ensures partial progress is
  # saved if the process is interrupted.
  # ============================================================================

  Scenario: Files are written immediately after processing (not batched)
    Given a mock Tauri environment
    And an in-memory filesystem
    And three markdown files each containing a unique remote image
    And downloads are configured to succeed for all files
    When I run downloadMediaAndUpdate
    Then all three files should have updated references
    And all three files should be written to disk

  Scenario: Early files are saved when later downloads fail
    Given a mock Tauri environment
    And an in-memory filesystem
    And three markdown files each containing a unique remote image
    And the second file's download is configured to fail
    When I run downloadMediaAndUpdate
    Then the first file should have updated references and be written
    And the second file should still have remote references
    And the third file should have updated references and be written

  Scenario: Write happens per-file not per-image
    Given a mock Tauri environment
    And an in-memory filesystem
    And a markdown file with three remote images
    And all three downloads are configured to succeed
    When I run downloadMediaAndUpdate
    Then the file should be written exactly once with all three references updated
