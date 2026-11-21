// Signs each channel plugin in and out in moss's own engine, with a person who
// is slower than moss's hook watchdog, against a local copy of its network.
//
//   node sign-in.mjs --contract /path/to/moss-contract [--only mastodon] [--dist mastodon=/path/to/dist] [--keep]
//
// moss-contract is built from moss with `cargo build -p moss-cli --features contract --bin moss-contract`.
// Each check prints one line; exit status 0 means every check passed.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const contract = flag("--contract");
if (!contract) {
  console.error("usage: node sign-in.mjs --contract <moss-contract> [--only a,b] [--dist id=dir] [--keep]");
  process.exit(2);
}
const only = flag("--only")?.split(",");
const dists = Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === "--dist" ? [a.split("=")] : [])));

// The watchdog moss-contract runs with, and how long the person takes: longer,
// as a person reading a page does.
const WATCHDOG_SECS = 2;
const PERSON_MS = (WATCHDOG_SECS + 1) * 1000;

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

// Async, so the local network in this process can answer while moss-contract runs.
async function run(id, network, person) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `sign-in-${id}-`));
  const folder = path.join(scratch, "site");
  const dist = dists[id] ?? path.join(root, "plugins", id, "dist");
  if (!fs.existsSync(path.join(dist, "manifest.json"))) throw new Error(`${dist} is not built: run npm run build in plugins/${id}`);
  fs.cpSync(dist, path.join(folder, ".moss/plugins", id), { recursive: true });
  fs.writeFileSync(path.join(folder, "index.md"), "# Test\n");
  const script = path.join(scratch, "person.json");
  fs.writeFileSync(script, JSON.stringify(person));
  const { stdout: out } = await promisify(execFile)(contract, [folder, id, "login", "logout", "--person", script, "--watchdog-secs", String(WATCHDOG_SECS)], {
    env: { ...process.env, HOME: path.join(scratch, "home") },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (!args.includes("--keep")) fs.rmSync(scratch, { recursive: true, force: true });
  if (args.includes("--verbose")) console.log(out);
  return out.trim().split("\n").map((l) => JSON.parse(l));
}

// What every plugin that signs in owns, whatever its network.
function signsInAndOut(id, [login, logout], { name, quick }) {
  const outcome = login.answer.signed_in?.outcome;
  const who = quick ? "a quick person" : `a person slower than the ${WATCHDOG_SECS}s watchdog`;
  check(login.answer.ok && outcome?.status === "completed", `${id}: login completes with ${who} (${login.answer.error ?? outcome?.message ?? outcome?.status})`);
  if (quick) return;
  check(JSON.stringify(login.account).includes(name), `${id}: the account row names ${name}, not an id (${JSON.stringify(login.account)})`);
  check(Object.values(login.secrets).some(Boolean), `${id}: login keeps its session in a secret its manifest declares (${JSON.stringify(login.secrets)})`);
  check(logout.answer.ok, `${id}: logout succeeds (${logout.answer.failed?.join("; ")})`);
  check(!JSON.stringify(logout.account).includes(name), `${id}: after logout the folder shows no account (${JSON.stringify(logout.account)})`);
  check(!Object.values(logout.secrets).some(Boolean), `${id}: after logout no declared secret is held (${JSON.stringify(logout.secrets)})`);
  check(!logout.cookies || (Array.isArray(logout.cookies) && logout.cookies.length === 0), `${id}: after logout no cookie is kept`);
}

const channels = {
  async mastodon() {
    const network = await (await import("./sign-in/mastodon.mjs")).start();
    try {
      const person = (after_ms) => ({
        steps: [
          { on: "page", matching: "mastodon:server", after_ms, do: "emit", event: "mastodon:server", payload: { typed: network.address } },
          { on: "browser", matching: "/oauth/authorize", do: "follow" },
        ],
      });
      signsInAndOut("mastodon", await run("mastodon", network, person(200)), { name: "ada", quick: true });
      signsInAndOut("mastodon", await run("mastodon", network, person(PERSON_MS)), { name: "ada" });
      check(network.revoked.length >= 1, "mastodon: logout revokes the token on its server");
    } finally {
      await network.stop();
    }
  },
};

for (const [id, channel] of Object.entries(channels)) {
  if (only && !only.includes(id)) continue;
  try {
    await channel();
  } catch (e) {
    check(false, `${id}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
