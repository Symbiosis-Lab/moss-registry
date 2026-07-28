Feature: Download Retry Logic
  As a developer
  I want downloads to retry on transient failures
  So that temporary issues don't cause permanent failures

  Scenario: Retries with Fibonacci backoff on 503
    Given a mock Tauri environment
    Given an in-memory filesystem
    Given an image URL that returns 503 twice then succeeds
    When I download the image with retry enabled
    Then it should retry with Fibonacci delays
    And the download should succeed on attempt 3

  Scenario: Gives up after max retries
    Given a mock Tauri environment
    Given an in-memory filesystem
    Given an image URL that always returns 503
    When I download the image with max 3 retries
    Then it should attempt 4 times total
    And the download should fail with 503 error

  Scenario: Does not retry on 404
    Given a mock Tauri environment
    Given an in-memory filesystem
    Given an image URL that returns 404
    When I download the image with retry enabled
    Then it should not retry
    And the download should fail immediately with 404 error

  Scenario: Retries on network timeout
    Given a mock Tauri environment
    Given an in-memory filesystem
    Given an image URL that times out twice then succeeds
    When I download the image with retry enabled
    Then it should retry after timeouts
    And the download should succeed on attempt 3
