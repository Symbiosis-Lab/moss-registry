/**
 * OnionPress deployer constants.
 *
 * These mirror the static-receiver wire contract, `docs/static-publish-protocol.md`
 * in the OnionPress fork. Both sides implement exactly these values.
 */

/**
 * Deploy heartbeat interval in milliseconds.
 *
 * Must be shorter than the progress panel's 60s inactivity watchdog (and the
 * 15s STALE_TIMEOUT_MS) so the progress bar stays visible while the tar +
 * upload of a large generation is in flight. Mirrors the github plugin.
 */
export const DEPLOY_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Ports probed for a running OnionPress receiver, in order.
 *
 * OnionPress multi-user installs offset the loopback receiver port by +10000
 * per user, so 8080 is single-user and 18080/28080/... are additional users.
 * The FIRST port whose `/status` returns a JSON body containing
 * `receiver_version` wins.
 */
export const RECEIVER_PORTS: readonly number[] = [8080, 18080, 28080, 38080, 48080];

/** Base REST namespace exposed by the OnionPress WordPress receiver plugin. */
export const RECEIVER_API_PATH = "/wp-json/onionpress/v1";

/** curl connect+transfer timeout for the lightweight `/status` probe (seconds). */
export const STATUS_PROBE_TIMEOUT_SECONDS = 3;

/**
 * How long, after `/commit`, to wait for the receiver's own reachability
 * check to resolve `onion_reachable` before falling back to local-health-only
 * copy (moss#917). The check is a real Tor-routed dual probe on the receiver
 * side, not instant — but the deploy flow can't wait indefinitely either.
 */
export const REACHABILITY_POLL_TIMEOUT_MS = 20_000;

/** Interval between `/status` polls while waiting for `onion_reachable`. */
export const REACHABILITY_POLL_INTERVAL_MS = 2_000;

/**
 * The sealed generation to publish. `.moss/build/current` is a symlink into
 * `.moss/build/generations/<id>/`; `tar -C` follows it, so the archive holds
 * the generation dir CONTENTS at tar root (`index.html`, `assets/…`).
 * Relative to the project root — `executeBinary` runs with cwd = project root.
 */
export const CURRENT_BUILD_PATH = ".moss/build/current";
