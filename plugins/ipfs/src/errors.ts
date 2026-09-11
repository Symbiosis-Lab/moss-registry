/**
 * Map a raw error message to a short, user-facing toast string.
 * Mirrors the categorization in github/src/main.ts:485-516; labels stay
 * provider-neutral because this runs for both backends.
 */
export function categorizeError(errorMessage: string): string {
  const lower = errorMessage.toLowerCase();

  if (
    lower.includes("econnrefused") ||
    lower.includes(":5001") ||
    lower.includes("daemon") ||
    lower.includes("not running")
  ) {
    return "IPFS daemon not running";
  }
  if (
    lower.includes("auth") ||
    lower.includes("jwt") ||
    lower.includes("token") ||
    lower.includes("401") ||
    lower.includes("403")
  ) {
    return "Authentication failed";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "Upload may still be pinning. Check your provider in a moment.";
  }
  if (lower.includes("network") || lower.includes("connection")) {
    return "Network error";
  }
  if (errorMessage.length > 50) {
    return errorMessage.slice(0, 50) + "...";
  }
  return errorMessage;
}
