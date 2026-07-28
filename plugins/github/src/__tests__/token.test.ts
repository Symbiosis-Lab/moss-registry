/**
 * Unit tests for token storage module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  setupMockTauri,
  type MockTauriContext,
} from "@symbiosis-lab/moss-api/testing";
import {
  formatCredentialInput,
  parseCredentialOutput,
  getTokenFromGit,
} from "../token";

// token.ts no longer imports from utils — no mock needed

describe("token", () => {
  describe("formatCredentialInput", () => {
    it("formats basic protocol and host", () => {
      const result = formatCredentialInput("github.com", "https");
      expect(result).toBe("protocol=https\nhost=github.com\n");
    });

    it("includes username when provided", () => {
      const result = formatCredentialInput("github.com", "https", "x-access-token");
      expect(result).toBe("protocol=https\nhost=github.com\nusername=x-access-token\n");
    });

    it("includes password when provided", () => {
      const result = formatCredentialInput("github.com", "https", "x-access-token", "ghp_abc123");
      expect(result).toBe(
        "protocol=https\nhost=github.com\nusername=x-access-token\npassword=ghp_abc123\n"
      );
    });

    it("handles password without username", () => {
      const result = formatCredentialInput("github.com", "https", undefined, "ghp_abc123");
      expect(result).toBe("protocol=https\nhost=github.com\npassword=ghp_abc123\n");
    });
  });

  describe("parseCredentialOutput", () => {
    it("parses username from output", () => {
      const output = "protocol=https\nhost=github.com\nusername=x-access-token\n";
      const result = parseCredentialOutput(output);
      expect(result.username).toBe("x-access-token");
      expect(result.password).toBeUndefined();
    });

    it("parses password from output", () => {
      const output = "protocol=https\nhost=github.com\npassword=ghp_abc123\n";
      const result = parseCredentialOutput(output);
      expect(result.password).toBe("ghp_abc123");
    });

    it("parses both username and password", () => {
      const output =
        "protocol=https\nhost=github.com\nusername=x-access-token\npassword=ghp_abc123\n";
      const result = parseCredentialOutput(output);
      expect(result.username).toBe("x-access-token");
      expect(result.password).toBe("ghp_abc123");
    });

    it("handles empty output", () => {
      const result = parseCredentialOutput("");
      expect(result.username).toBeUndefined();
      expect(result.password).toBeUndefined();
    });

    it("handles passwords with equals signs", () => {
      const output = "password=ghp_abc=123=def\n";
      const result = parseCredentialOutput(output);
      expect(result.password).toBe("ghp_abc=123=def");
    });

    it("handles extra fields gracefully", () => {
      const output = "protocol=https\nhost=github.com\npath=repo\nusername=user\npassword=pass\n";
      const result = parseCredentialOutput(output);
      expect(result.username).toBe("user");
      expect(result.password).toBe("pass");
    });
  });

  // =========================================================================
  // getTokenFromGit tests (Bug 8: Git credential helper integration)
  // =========================================================================
  describe("getTokenFromGit", () => {
    let ctx: MockTauriContext;

    beforeEach(() => {
      ctx = setupMockTauri();
      vi.clearAllMocks();
    });

    afterEach(() => {
      ctx.cleanup();
    });

    it("returns token from git credential helper when available", async () => {
      // Mock git credential fill returning a valid token
      ctx.binaryConfig.setResult("git credential fill", {
        success: true,
        exitCode: 0,
        stdout: "protocol=https\nhost=github.com\nusername=x-access-token\npassword=ghp_xxxxx\n",
        stderr: "",
      });

      const token = await getTokenFromGit();
      expect(token).toBe("ghp_xxxxx");
    });

    it("returns null when no credentials in git", async () => {
      // Mock git credential fill failing (no credentials stored)
      ctx.binaryConfig.setResult("git credential fill", {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "credential helper quit",
      });

      const token = await getTokenFromGit();
      expect(token).toBeNull();
    });

    it("returns null when git credential helper returns empty password", async () => {
      // Mock git credential fill returning no password
      ctx.binaryConfig.setResult("git credential fill", {
        success: true,
        exitCode: 0,
        stdout: "protocol=https\nhost=github.com\n",
        stderr: "",
      });

      const token = await getTokenFromGit();
      expect(token).toBeNull();
    });

    it("handles git command not found gracefully", async () => {
      // Mock git not being available
      ctx.binaryConfig.setResult("git credential fill", {
        success: false,
        exitCode: 127,
        stdout: "",
        stderr: "git: command not found",
      });

      const token = await getTokenFromGit();
      expect(token).toBeNull();
    });
  });
});
