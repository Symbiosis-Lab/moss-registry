/**
 * The provider abstraction — the plugin's extensibility seam.
 *
 * Both backends (Pinata, local Kubo) implement this one interface so main.ts
 * never branches on provider mid-deploy. Adding a new backend is a matter of
 * implementing IpfsProvider and registering it in providers/index.ts.
 */

import type { SetupVerdict } from "@symbiosis-lab/moss-api";
import type {
  ProviderId,
  SiteFile,
  DeployOutput,
  ReadyState,
  StructureVerdict,
  UploadProgress,
} from "../types";

export interface IpfsProvider {
  id: ProviderId;
  label: string;

  /**
   * Whether the provider is ready to deploy, or a human reason why not.
   *
   * Cheap and non-interactive: getting ready is `check_setup`'s conversation
   * with the user (setup.ts), which moss runs on the Publish click. This is
   * the guard for a publish that never passed through it — a headless build.
   */
  checkReady(): Promise<ReadyState>;

  /**
   * The publish setup gate's answer for this backend (ADR-072): can it publish
   * right now, and if not, what can the user do about it?
   *
   * Re-invoked with the id of whichever action the user clicked, so it is a
   * short conversation rather than a single verdict. Only a click may change
   * anything on the user's machine — called with no action it is a probe.
   */
  checkSetup(action?: string): Promise<SetupVerdict>;

  /** Pin the whole site directory (one multipart request); returns the root CID. */
  uploadDir(files: SiteFile[], onProgress: UploadProgress): Promise<DeployOutput>;

  /**
   * Check that the pinned directory actually reconstructed: does `nestedPath`
   * resolve under `cid` on this provider's own read path? Must distinguish
   * "definitively missing" (broken) from "can't tell right now" (inconclusive)
   * — transport errors and rate limits are NEVER "broken".
   */
  verifyDirectory(cid: string, nestedPath: string): Promise<StructureVerdict>;
}
