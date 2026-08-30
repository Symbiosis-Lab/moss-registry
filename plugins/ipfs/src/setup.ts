/**
 * check_setup — the readiness conversation moss drives.
 *
 * moss draws every dialog; this module only answers verdicts. Each invocation
 * re-derives from durable state (the keystore, the daemon's RPC, the node's
 * config), so a cold call after a restart lands in the right step without any
 * remembered conversation. `ctx.action` is the id of the blocker the user just
 * submitted; every action here is a button (zero-field forms) because all the
 * typed input this plugin needs is declared `settings` moss already collects.
 *
 * The daemon-start blocker's message carries the consent facts the old panel
 * showed (outlives moss, does not survive a reboot, stopped manually) — the
 * click on "Start IPFS" is the consent, asked exactly when it applies instead
 * of once per project.
 */

import type { SetupBlocker, SetupContext, SetupVerdict, IpfsSettings } from "./types";
import { readSettings } from "./settings";
import { getPinataJwt, rejectPinataJwt } from "./credentials";
import { getWithHeaders, postRaw } from "./http";
import { PINATA_TEST_AUTH_URL, API_TIMEOUT_MS, DAEMON_PROBE_TIMEOUT_MS } from "./constants";
import { kuboRpcBase, isDefaultNodeRpc } from "./gateways";
import {
  bootstrapLocalNode,
  kuboInstalled,
  diagnoseDaemon,
  describeDaemonFailure,
} from "./kubo-bootstrap";
import { findFreeGatewayPort, setGatewayPort } from "./kubo-gateway";
import { reportProgress, sleep } from "./utils";

const START_DAEMON = "start_daemon";
const CHANGE_PORT = "change_port";
const RECHECK = "recheck";
const PINATA_RETRY = "pinata_auth";

function blocked(blocker: SetupBlocker): SetupVerdict {
  return { status: "blocked", blockers: [blocker] };
}

const READY: SetupVerdict = { status: "ready" };

export async function checkSetup(ctx: SetupContext): Promise<SetupVerdict> {
  const config = readSettings(ctx.settings);
  if (config.provider === "pinata") {
    return pinataVerdict();
  }
  return localVerdict(config, ctx.action);
}

// ---------------------------------------------------------------------------
// Pinata: the token must exist and Pinata must still honour it
// ---------------------------------------------------------------------------

function isAuthStatus(status: number): boolean {
  return status === 401 || status === 403;
}

async function testAuth(jwt: string): Promise<number> {
  const res = await getWithHeaders(
    PINATA_TEST_AUTH_URL,
    { Authorization: `Bearer ${jwt}` },
    API_TIMEOUT_MS,
  );
  return res.status;
}

async function pinataVerdict(): Promise<SetupVerdict> {
  // moss collects applicable secrets before the hook runs, so null means
  // nobody could be asked (headless) or the user cancelled the ask.
  const jwt = await getPinataJwt();
  if (!jwt) {
    return blocked({
      id: PINATA_RETRY,
      message: "Publishing to Pinata needs an API token.",
      form: { fields: [], submit: "Try again" },
    });
  }
  // Pre-flight so a stale token re-asks BEFORE a long upload. Transport
  // failures (status 0 / 5xx) don't block — the authenticated upload is the
  // final arbiter.
  if (!isAuthStatus(await testAuth(jwt))) return READY;

  // The stored token is bad: forget it and re-ask with the reason. moss
  // resolves with the replacement, or null when the user declined.
  const fresh = await rejectPinataJwt("Pinata says this token is no longer valid.");
  if (fresh && !isAuthStatus(await testAuth(fresh))) return READY;
  return blocked({
    id: PINATA_RETRY,
    message: fresh
      ? "Pinata rejected that token too — check it has Files write access."
      : "Publishing to Pinata needs a valid API token.",
    form: { fields: [], submit: "Try again" },
  });
}

// ---------------------------------------------------------------------------
// Local Kubo: a daemon must answer the RPC
// ---------------------------------------------------------------------------

async function daemonReachable(config: IpfsSettings): Promise<boolean> {
  try {
    const res = await postRaw(
      `${kuboRpcBase(config)}/api/v0/version`,
      {},
      { timeoutMs: DAEMON_PROBE_TIMEOUT_MS },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function localVerdict(config: IpfsSettings, action?: string): Promise<SetupVerdict> {
  if (action === START_DAEMON || action === CHANGE_PORT) {
    return startDaemon(config, action === CHANGE_PORT);
  }
  if (await daemonReachable(config)) return READY;

  if (!isDefaultNodeRpc(config)) {
    // A remote node is not moss's to start.
    return blocked({
      id: RECHECK,
      message: `No IPFS node answered at ${kuboRpcBase(config)} — check that it's running and reachable.`,
      form: { fields: [], submit: "Check again" },
    });
  }
  if (!(await kuboInstalled())) {
    return blocked({
      id: RECHECK,
      message:
        "Publishing through your own node needs IPFS installed on this computer. " +
        "The easiest way is IPFS Desktop (docs.ipfs.tech/install/ipfs-desktop) — install it, " +
        "open it once, then check again. Prefer a hosted option? Switch the pinning service " +
        "to Pinata in the plugin's settings.",
      form: { fields: [], submit: "Check again" },
    });
  }
  return blocked({
    id: START_DAEMON,
    message:
      "To publish through your own node, moss starts IPFS on this computer. " +
      "It keeps running after you quit moss — that is what keeps your site reachable. " +
      "It does not start again by itself after a restart. To stop it: quit IPFS Desktop " +
      "if you use it, or run `ipfs shutdown` in Terminal.",
    form: { fields: [], submit: "Start IPFS" },
  });
}

/**
 * One start attempt per click. `movePort` re-derives the free port at action
 * time (a cold invocation cannot trust a number from an earlier verdict's
 * message) and edits the node's own config, which is why it gets its own
 * button rather than happening silently.
 */
async function startDaemon(config: IpfsSettings, movePort: boolean): Promise<SetupVerdict> {
  if (movePort) {
    const suggested = await findFreeGatewayPort();
    if (suggested === null || !(await setGatewayPort(suggested))) {
      return blocked({
        id: START_DAEMON,
        message: "moss could not change the gateway port in your IPFS config.",
        form: { fields: [], submit: "Try again" },
      });
    }
  }

  let statusMessage = "Setting up an IPFS node...";
  const heartbeat = setInterval(() => {
    void reportProgress("setup", 2, 10, statusMessage);
  }, 5000);
  let result;
  try {
    result = await bootstrapLocalNode((message) => {
      statusMessage = message;
      void reportProgress("setup", 2, 10, message);
    });
  } finally {
    clearInterval(heartbeat);
  }

  if (!result.ok) {
    const reason = result.reason ?? "Automatic node setup failed.";
    if (result.gatewayPortTaken !== undefined && (await findFreeGatewayPort()) !== null) {
      return blocked({
        id: CHANGE_PORT,
        message:
          `${reason} moss can move your node's gateway to a free port instead — this edits ` +
          "your IPFS node's own configuration, which is why it asks first. Nothing else " +
          "about your node changes.",
        form: { fields: [], submit: "Move the gateway port" },
      });
    }
    return blocked({
      id: START_DAEMON,
      message: reason,
      form: { fields: [], submit: "Retry" },
    });
  }

  // The spawn is detached, so its exit status proves nothing — poll the RPC
  // (~45s budget), then ask the process itself what went wrong.
  for (let i = 0; i < 22; i++) {
    await reportProgress("setup", 2, 10, `Waiting for the IPFS node... (${i + 1}/22)`);
    if (await daemonReachable(config)) return READY;
    await sleep(2000);
  }
  const diagnosis = result.daemon ? await diagnoseDaemon(result.daemon) : null;
  return blocked({
    id: START_DAEMON,
    message: describeDaemonFailure(diagnosis),
    form: { fields: [], submit: "Retry" },
  });
}
