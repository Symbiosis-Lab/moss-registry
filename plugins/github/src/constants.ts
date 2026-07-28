/**
 * Deploy heartbeat interval in milliseconds.
 *
 * Must be shorter than the progress panel's STALE_TIMEOUT_MS (15s)
 * so the progress bar stays visible during long git push operations.
 */
export const DEPLOY_HEARTBEAT_INTERVAL_MS = 10_000;
