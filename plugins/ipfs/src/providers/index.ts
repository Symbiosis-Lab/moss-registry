/**
 * Provider registry / factory.
 *
 * Selects the backend from config. Adding a new backend means implementing
 * IpfsProvider and adding one case here.
 */

import type { IpfsProvider } from "./types";
import type { IpfsPluginConfig, ProviderId } from "../types";
import { PinataProvider } from "./pinata";
import { LocalProvider } from "./local";

export type { IpfsProvider } from "./types";

/** Construct a provider by id (used directly for co-pinning). */
export function makeProviderById(id: ProviderId, config: IpfsPluginConfig): IpfsProvider {
  return id === "local" ? new LocalProvider(config) : new PinataProvider(config);
}

/** Construct the provider selected in config (defaults to Pinata). */
export function getProvider(config: IpfsPluginConfig): IpfsProvider {
  return makeProviderById(config.provider === "local" ? "local" : "pinata", config);
}
