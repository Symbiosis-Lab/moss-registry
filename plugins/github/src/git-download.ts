import { startTask, type EscapeSpec } from "@symbiosis-lab/moss-api";
import { resolveGitPath, sleep } from "./utils";

/** How long a deploy waits for the user to download git before it fails. */
const GIT_WAIT_MS = 10 * 60 * 1000;
const GIT_POLL_MS = 2000;

/**
 * Git is missing: put a task in the awaiting state with the Download button as
 * its escape, and poll until git resolves. Resolves to null when the wait
 * elapses, and the deploy then fails with its usual git message.
 */
export async function waitForGit(): Promise<string | null> {
  const task = await startTask("Git", {
    hook: "deploy",
    trigger: "manual_one",
    hasProgress: false,
    cancellable: true,
  });
  // The host renders this escape as the Download button.
  const escape: EscapeSpec = "download-tool:git";
  await task.awaiting(
    "Git is needed to publish to GitHub. Download it to continue.",
    "",
    escape,
  );
  const deadline = Date.now() + GIT_WAIT_MS;
  let gitPath: string | null = null;
  while (!gitPath && Date.now() < deadline) {
    await sleep(GIT_POLL_MS);
    gitPath = await resolveGitPath();
  }
  if (gitPath) await task.succeeded();
  else await task.failed("Git was not installed within 10 minutes.");
  return gitPath;
}
