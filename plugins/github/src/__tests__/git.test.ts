/**
 * Unit tests for git.ts pure functions
 *
 * These tests cover the pure functions for URL parsing.
 */

import { describe, it, expect } from "vitest";
import { parseGitHubUrl, extractGitHubPagesUrl, buildPagesUrl, isRootRepo } from "../git";

describe("parseGitHubUrl", () => {
  describe("HTTPS URLs", () => {
    it("parses standard HTTPS URL", () => {
      const result = parseGitHubUrl("https://github.com/user/repo.git");
      expect(result).toEqual({ owner: "user", repo: "repo" });
    });

    it("parses HTTPS URL without .git extension", () => {
      const result = parseGitHubUrl("https://github.com/user/repo");
      expect(result).toEqual({ owner: "user", repo: "repo" });
    });

    it("parses org repo HTTPS URL", () => {
      const result = parseGitHubUrl("https://github.com/symbiosis-lab/moss.git");
      expect(result).toEqual({ owner: "symbiosis-lab", repo: "moss" });
    });

    it("handles hyphenated repo names", () => {
      const result = parseGitHubUrl("https://github.com/user/my-awesome-repo.git");
      expect(result).toEqual({ owner: "user", repo: "my-awesome-repo" });
    });

    it("handles underscored repo names", () => {
      const result = parseGitHubUrl("https://github.com/user/my_repo.git");
      expect(result).toEqual({ owner: "user", repo: "my_repo" });
    });

    it("parses user site repo with dots (username.github.io)", () => {
      const result = parseGitHubUrl("https://github.com/guoliu/guoliu.github.io.git");
      expect(result).toEqual({ owner: "guoliu", repo: "guoliu.github.io" });
    });

    it("parses user site repo without .git suffix", () => {
      const result = parseGitHubUrl("https://github.com/guoliu/guoliu.github.io");
      expect(result).toEqual({ owner: "guoliu", repo: "guoliu.github.io" });
    });

    it("parses repo name with dots", () => {
      const result = parseGitHubUrl("https://github.com/user/my.project.name.git");
      expect(result).toEqual({ owner: "user", repo: "my.project.name" });
    });
  });

  describe("SSH URLs", () => {
    it("parses standard SSH URL", () => {
      const result = parseGitHubUrl("git@github.com:user/repo.git");
      expect(result).toEqual({ owner: "user", repo: "repo" });
    });

    it("parses SSH URL without .git extension", () => {
      const result = parseGitHubUrl("git@github.com:user/repo");
      expect(result).toEqual({ owner: "user", repo: "repo" });
    });

    it("parses org repo SSH URL", () => {
      const result = parseGitHubUrl("git@github.com:symbiosis-lab/moss.git");
      expect(result).toEqual({ owner: "symbiosis-lab", repo: "moss" });
    });

    it("parses user site repo with dots (username.github.io) via SSH", () => {
      const result = parseGitHubUrl("git@github.com:guoliu/guoliu.github.io.git");
      expect(result).toEqual({ owner: "guoliu", repo: "guoliu.github.io" });
    });

    it("parses user site repo without .git suffix via SSH", () => {
      const result = parseGitHubUrl("git@github.com:guoliu/guoliu.github.io");
      expect(result).toEqual({ owner: "guoliu", repo: "guoliu.github.io" });
    });
  });

  describe("invalid URLs", () => {
    it("returns null for non-GitHub HTTPS URL", () => {
      const result = parseGitHubUrl("https://gitlab.com/user/repo.git");
      expect(result).toBeNull();
    });

    it("returns null for non-GitHub SSH URL", () => {
      const result = parseGitHubUrl("git@gitlab.com:user/repo.git");
      expect(result).toBeNull();
    });

    it("returns null for malformed URL", () => {
      const result = parseGitHubUrl("not-a-valid-url");
      expect(result).toBeNull();
    });

    it("returns null for empty string", () => {
      const result = parseGitHubUrl("");
      expect(result).toBeNull();
    });

    it("returns null for GitHub URL with extra path segments", () => {
      const result = parseGitHubUrl("https://github.com/user/repo/extra");
      expect(result).toBeNull();
    });
  });
});

describe("extractGitHubPagesUrl", () => {
  it("generates correct Pages URL from HTTPS remote", () => {
    const result = extractGitHubPagesUrl("https://github.com/user/repo.git");
    expect(result).toBe("https://user.github.io/repo");
  });

  it("generates correct Pages URL from SSH remote", () => {
    const result = extractGitHubPagesUrl("git@github.com:user/repo.git");
    expect(result).toBe("https://user.github.io/repo");
  });

  it("generates correct Pages URL for org repos", () => {
    const result = extractGitHubPagesUrl("https://github.com/symbiosis-lab/moss.git");
    expect(result).toBe("https://symbiosis-lab.github.io/moss");
  });

  it("generates root URL for user site repo (SSH)", () => {
    const result = extractGitHubPagesUrl("git@github.com:guoliu/guoliu.github.io.git");
    expect(result).toBe("https://guoliu.github.io");
  });

  it("generates root URL for user site repo (HTTPS)", () => {
    const result = extractGitHubPagesUrl("https://github.com/guoliu/guoliu.github.io.git");
    expect(result).toBe("https://guoliu.github.io");
  });

  it("generates root URL for user site repo (case-insensitive)", () => {
    const result = extractGitHubPagesUrl("git@github.com:GuoLiu/GuoLiu.github.io.git");
    expect(result).toBe("https://GuoLiu.github.io");
  });

  it("throws for non-GitHub URLs", () => {
    expect(() => {
      extractGitHubPagesUrl("https://gitlab.com/user/repo.git");
    }).toThrow("Could not parse GitHub URL from remote");
  });

  it("throws for invalid URLs", () => {
    expect(() => {
      extractGitHubPagesUrl("not-a-url");
    }).toThrow("Could not parse GitHub URL from remote");
  });
});

describe("isRootRepo", () => {
  it("returns true for exact match (alice/alice.github.io)", () => {
    expect(isRootRepo("alice", "alice.github.io")).toBe(true);
  });

  it("returns true for case-insensitive owner (Alice/alice.github.io)", () => {
    expect(isRootRepo("Alice", "alice.github.io")).toBe(true);
  });

  it("returns true for case-insensitive both (Alice/Alice.github.io)", () => {
    expect(isRootRepo("Alice", "Alice.github.io")).toBe(true);
  });

  it("returns false for non-root repo (alice/my-website)", () => {
    expect(isRootRepo("alice", "my-website")).toBe(false);
  });

  it("returns false for different user's root repo (alice/bob.github.io)", () => {
    expect(isRootRepo("alice", "bob.github.io")).toBe(false);
  });
});

describe("buildPagesUrl", () => {
  it("generates project URL for regular repo", () => {
    expect(buildPagesUrl("user", "repo")).toBe("https://user.github.io/repo");
  });

  it("generates root URL for user site repo (exact match)", () => {
    expect(buildPagesUrl("guoliu", "guoliu.github.io")).toBe("https://guoliu.github.io");
  });

  it("generates root URL for user site repo (case-insensitive)", () => {
    expect(buildPagesUrl("GuoLiu", "GuoLiu.github.io")).toBe("https://GuoLiu.github.io");
  });

  it("generates project URL for org repo", () => {
    expect(buildPagesUrl("symbiosis-lab", "moss")).toBe("https://symbiosis-lab.github.io/moss");
  });
});
