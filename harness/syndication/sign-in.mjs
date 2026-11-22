// Signs each channel plugin in and out in moss's own engine, with a person who
// is slower than moss's hook watchdog, against the local copy of its network
// that run.mjs publishes to.
//
//   node sign-in.mjs --contract /path/to/moss-contract [--only mastodon] [--dist mastodon=/path/to/dist] [--keep] [--verbose]
//   node sign-in.mjs --contract /path/to/moss-contract --sweep /path/to/site
//
// moss-contract is built from moss with `cargo build -p moss-cli --features contract --bin moss-contract`.
// Each check prints one line; exit status 0 means every check passed.
//
// --sweep runs every sign-in plugin installed in a site, with no network and a
// person who never answers: it shows what each one opens first, whether moss's
// watchdog ends a sign-in that is waiting on that person, and any secret moss
// refused or warned about. The person closes any panel after the watchdog's
// limit; a sign-in still waiting after SWEEP_MS is reported, not failed (a
// system browser cannot be closed from here). It reads the site's plugins and
// writes nothing there.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import http from "node:http";
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
  console.error("usage: node sign-in.mjs --contract <moss-contract> [--only a,b] [--dist id=dir] [--keep] [--verbose] | --sweep <site>");
  process.exit(2);
}
const only = flag("--only")?.split(",");
const dists = Object.fromEntries(args.flatMap((a, i) => (args[i - 1] === "--dist" ? [a.split("=")] : [])));

// The watchdog moss-contract runs with, and how long the person takes: longer,
// as a person reading a page does.
const WATCHDOG_SECS = 2;
const PERSON_MS = (WATCHDOG_SECS + 1) * 1000;
const SWEEP_MS = 20_000;
// A person who closes the panel, as the desktop reports any close.
const closes = (on) => ({ on, after_ms: PERSON_MS, do: "emit", event: "browser-closed", payload: { reason: "user" } });

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

// Async, so the local network in this process can answer while moss-contract runs.
async function run(id, dist, person, hooks = ["login", "logout"], timeout = 120_000) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `sign-in-${id}-`));
  const folder = path.join(scratch, "site");
  if (!fs.existsSync(path.join(dist, "manifest.json"))) throw new Error(`${dist} is not built: run npm run build in plugins/${id}`);
  fs.cpSync(dist, path.join(folder, ".moss/plugins", id), { recursive: true });
  fs.writeFileSync(path.join(folder, "index.md"), "# Test\n");
  const script = path.join(scratch, "person.json");
  fs.writeFileSync(script, JSON.stringify(person));
  try {
    const { stdout: out } = await promisify(execFile)(contract, [folder, id, ...hooks, "--person", script, "--watchdog-secs", String(WATCHDOG_SECS)], {
      env: { ...process.env, HOME: path.join(scratch, "home") },
      encoding: "utf8",
      timeout,
    });
    if (args.includes("--verbose")) console.log(out);
    return out.trim().split("\n").map((l) => JSON.parse(l));
  } finally {
    if (!args.includes("--keep")) fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// moss's own lines about a secret the plugin wrote without declaring it.
const custody = (report) => report.seen.filter((s) => s.what === "log" && /set_plugin_secret' refused|without declaring custody/.test(s.detail.message)).map((s) => s.detail.message);

// What every plugin that signs in owns, whatever its network.
function signsInAndOut(id, [login, logout], { name, quick }) {
  const outcome = login.answer.signed_in?.outcome;
  const who = quick ? "a quick person" : `a person slower than the ${WATCHDOG_SECS}s watchdog`;
  check(login.answer.ok && outcome?.status === "completed", `${id}: login completes with ${who} (${login.answer.error ?? outcome?.message ?? outcome?.status})`);
  check(custody(login).length === 0, `${id}: login writes only secrets its manifest declares (${custody(login).join("; ")})`);
  if (quick) return;
  check(JSON.stringify(login.account).includes(name), `${id}: the account row names ${name}, not an id (${JSON.stringify(login.account)})`);
  check(Object.values(login.secrets).some(Boolean), `${id}: login keeps its session in a secret its manifest declares (${JSON.stringify(login.secrets)})`);
  check(logout.answer.ok, `${id}: logout succeeds (${logout.answer.failed?.join("; ")})`);
  check(!JSON.stringify(logout.account).includes(name), `${id}: after logout the folder shows no account (${JSON.stringify(logout.account)})`);
  check(!Object.values(logout.secrets).some(Boolean), `${id}: after logout no declared secret is held (${JSON.stringify(logout.secrets)})`);
  check(!logout.cookies || (Array.isArray(logout.cookies) && logout.cookies.length === 0), `${id}: after logout no cookie is kept`);
}

/** A loopback page a person's browser is sent through: `approve(url)` answers for them, then it redirects on. */
async function personAt(approve) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1").searchParams.get("url");
      res.writeHead(302, { location: await approve(url) });
    } catch (e) {
      console.error(`the person could not approve the sign-in: ${e.message}`);
      res.writeHead(502, { "content-type": "text/plain" });
      res.write(String(e.message));
    }
    res.end();
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { via: `http://127.0.0.1:${server.address().port}/approve?url=`, stop: () => new Promise((done) => server.close(done)) };
}

const channels = {
  async mastodon(dist) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sign-in-mastodon-net-"));
    const net = await (await import("./providers/mastodon.mjs")).start({ scratch });
    const person = await personAt(net.approve);
    try {
      const script = (after_ms) => ({
        steps: [
          // Plain http is a server address only on a loopback IP, not "localhost".
          { on: "page", matching: "mastodon:server", after_ms, do: "emit", event: "mastodon:server", payload: { typed: net.config.server.replace("localhost", "127.0.0.1") } },
          // A refused address leaves the picker open; the person gives up.
          { on: "event", matching: "mastodon:server-refused", do: "emit", event: "browser-closed", payload: { reason: "user" } },
          { on: "browser", matching: "/oauth/authorize", do: "follow", via: person.via },
        ],
      });
      signsInAndOut("mastodon", await run("mastodon", dist, script(200)), { name: "alex", quick: true });
      const before = (await net.appTokens()).length;
      signsInAndOut("mastodon", await run("mastodon", dist, script(PERSON_MS)), { name: "alex" });
      const after = (await net.appTokens()).length;
      check(after === before, `mastodon: logout revokes the token login got from its server (${before} → ${after} app tokens)`);
    } finally {
      await person.stop();
      await net.stop();
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  },
};

async function sweep(site) {
  const plugins = path.join(site, ".moss/plugins");
  for (const id of fs.readdirSync(plugins).sort()) {
    const manifest = path.join(plugins, id, "manifest.json");
    if (!fs.existsSync(manifest)) continue;
    const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (!m.contributes?.channel?.login) continue;
    try {
      const [login, logout] = await run(id, path.join(plugins, id), { steps: [closes("page"), closes("panel")] }, ["login", "logout"], SWEEP_MS);
      const opened = login.seen.filter((s) => /opened|shown|asked/.test(s.what)).map((s) => s.what);
      const timedOut = /timed out - no progress/.test(login.answer.error ?? "");
      const logs = login.seen.concat(logout.seen).filter((s) => s.what === "log").map((s) => `${s.detail.level} ${s.detail.message}`);
      console.log(`${id} ${m.version}: login ${login.answer.ok ? login.answer.signed_in?.outcome?.status : `error "${login.answer.error}"`} in ${login.ms}ms after ${opened.join(", ") || "nothing"}`);
      check(!(timedOut && opened.length), `${id}: a sign-in waiting on a person outlives the ${WATCHDOG_SECS}s watchdog`);
      check(custody(login).length === 0, `${id}: login writes only declared secrets (${custody(login).join("; ")})`);
      check(logout.answer.ok, `${id}: logout with nothing held succeeds (${logout.answer.failed?.join("; ")})`);
      for (const l of logs) console.log(`     ${l.slice(0, 300)}`);
    } catch (e) {
      if (e.killed) console.log(`${id} ${m.version}: still waiting after ${SWEEP_MS / 1000}s with the panel closed (a system browser sign-in, or a wait the close does not end)`);
      else check(false, `${id}: ${e.message.slice(0, 400)}`);
    }
  }
}

if (flag("--sweep")) {
  await sweep(flag("--sweep"));
} else {
  for (const [id, channel] of Object.entries(channels)) {
    if (only && !only.includes(id)) continue;
    try {
      await channel(dists[id] ?? path.join(root, "plugins", id, "dist"));
    } catch (e) {
      check(false, `${id}: ${e.message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
