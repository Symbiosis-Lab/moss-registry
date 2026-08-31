/**
 * The setup gate's GitHub half: what moss asks before a publish starts.
 *
 * The behaviour these protect is an ordering one — the sign-in must happen
 * here, on a button, and never halfway through a deploy.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../auth", () => ({
  resolveTokenOutcome: vi.fn(),
  promptLogin: vi.fn(),
}));

import { check_setup } from "../setup";
import { promptLogin, resolveTokenOutcome } from "../auth";

describe("check_setup", () => {
  beforeEach(() => {
    vi.mocked(resolveTokenOutcome).mockReset();
    vi.mocked(promptLogin).mockReset();
  });

  it("is ready when an account is already connected, and asks for nothing", async () => {
    vi.mocked(resolveTokenOutcome).mockResolvedValue({ token: "gho_token", unreachable: false });

    const result = await check_setup({ project_path: "/site", config: {} });

    expect(result.setup).toEqual({ ready: true });
    expect(promptLogin).not.toHaveBeenCalled();
  });

  it("offers one sign-in button when there is no account", async () => {
    vi.mocked(resolveTokenOutcome).mockResolvedValue({ token: null, unreachable: false });

    const result = await check_setup({ project_path: "/site", config: {} });

    expect(result.setup?.ready).toBe(false);
    expect(result.setup?.needs?.[0]?.actions).toEqual([
      { id: "sign_in", label: "Sign in to GitHub" },
    ]);
    expect(promptLogin).not.toHaveBeenCalled();
  });

  /**
   * Offline, the device flow needs the network that just failed, and the stored
   * token is probably fine. A "Sign in to GitHub" button here is both the wrong
   * diagnosis and a dead end.
   */
  it("does not offer a sign-in when GitHub could not be reached", async () => {
    vi.mocked(resolveTokenOutcome).mockResolvedValue({ token: null, unreachable: true });

    const result = await check_setup({ project_path: "/site", config: {} });

    expect(result.setup?.ready).toBe(false);
    expect(result.setup?.needs?.[0]?.actions).toBeUndefined();
    expect(result.setup?.needs?.[0]?.message).toContain("could not reach GitHub");
    expect(promptLogin).not.toHaveBeenCalled();
  });

  it("signs in when the button is clicked, and reports ready", async () => {
    vi.mocked(promptLogin).mockResolvedValue(true);
    vi.mocked(resolveTokenOutcome).mockResolvedValue({ token: "gho_token", unreachable: false });

    const result = await check_setup({ project_path: "/site", config: {}, action: "sign_in" });

    expect(promptLogin).toHaveBeenCalledOnce();
    expect(result.setup).toEqual({ ready: true });
  });

  it("re-offers the need when a sign-in is cancelled, rather than reporting ready", async () => {
    vi.mocked(promptLogin).mockResolvedValue(false);
    vi.mocked(resolveTokenOutcome).mockResolvedValue({ token: null, unreachable: false });

    const result = await check_setup({ project_path: "/site", config: {}, action: "sign_in" });

    expect(result.setup?.ready).toBe(false);
    expect(result.setup?.needs).toHaveLength(1);
  });
});
