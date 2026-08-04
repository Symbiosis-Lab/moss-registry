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

  /** Whether the provider is ready to deploy, or a human reason why not. */
  checkReady(): Promise<ReadyState>;

  /**
   * Run the provider-specific setup flow (Pinata: JWT panel; local: daemon
   * guidance). Resolves true once the provider is ready, false if cancelled.
   */
  runSetup(): Promise<boolean>;

  /** Pin the whole site directory (one multipart request); returns the root CID. */
  uploadDir(files: SiteFile[], onProgress: UploadProgress): Promise<DeployOutput>;

  /**
   * Check that the pinned directory actually reconstructed: does `nestedPath`
   * resolve under `cid` on this provider's own read path? Must distinguish
   * "definitively missing" (broken) from "can't tell right now" (inconclusive)
   * — transport errors and rate limits are NEVER "broken".
   */
  verifyDirectory(cid: string, nestedPath: string): Promise<StructureVerdict>;

  /** Publish/republish a stable IPNS name at the CID. Optional; degrades. */
  publishIpns?(cid: string): Promise<string | undefined>;

  /** The provider's own gateway URL for a CID. */
  gatewayUrl(cid: string): string;
}
