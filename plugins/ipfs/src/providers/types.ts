/**
 * The provider abstraction — the plugin's extensibility seam.
 *
 * Both backends (Pinata, local Kubo) implement this one interface so main.ts
 * never branches on provider mid-deploy. Adding a new backend is a matter of
 * implementing IpfsProvider and registering it in providers/index.ts.
 */

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
   * Interactive setup happens in `check_setup` (setup.ts) BEFORE deploy; this
   * is the headless gate — it may probe, but it never opens UI.
   */
  checkReady(): Promise<ReadyState>;

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
