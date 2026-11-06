// End-to-end check of moss syndication: real moss, headless, against a local
// copy of each network. One command:
//
//   node run.mjs --moss <path to moss binary> [--only bluesky,mastodon,linkedin,xcom] [--keep]
//
// It builds a small site in a scratch folder with its own HOME, publishes it
// through a deploy plugin that only reports the address a local server
// serves the build at, and lets moss post the copies. It then checks that each
// network holds exactly the copies `moss deploy --dry-run --json` said it
// would post, in order, with their replies, that each address is written back
// into its post, and that a second publish posts nothing.

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const plugins = path.resolve(here, "../../plugins");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const moss = flag("--moss");
const keep = args.includes("--keep");
if (!moss) {
  console.error("usage: node run.mjs --moss <path to moss binary> [--only bluesky,mastodon,linkedin,xcom] [--keep]");
  process.exit(2);
}
if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error(`the harness needs Node 24 or later (the AT Protocol dev environment's native modules), not ${process.version}`);
  process.exit(2);
}

const available = fs.readdirSync(path.join(here, "providers")).map((f) => f.replace(/\.mjs$/, ""));
const only = flag("--only")?.split(",") ?? available;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "moss-syndication-"));
const home = path.join(scratch, "home");
const site = path.join(scratch, "site");
fs.mkdirSync(home, { recursive: true });
const env = { ...process.env, HOME: home, MOSS_HOME: path.join(home, ".moss") };
delete env.MOSS_ENV;
delete env.MOSS_SETA_URL;

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

/** Async, so the server below keeps answering while moss fetches its pages. */
function runMoss(argv, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(moss, argv, { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) =>
      status === 0 ? resolve({ stdout, stderr }) : reject(new Error(`moss ${argv.join(" ")} exited ${status}:\n${stderr}`)),
    );
    child.stdin.end(input ?? "");
  });
}

/** Serves the site's current build, as the published site would be served. */
function serveBuild() {
  const root = path.join(site, ".moss/build.nosync/current");
  const server = http.createServer((req, res) => {
    let p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (p.endsWith("/")) p = path.join(p, "index.html");
    fs.readFile(p, (err, body) => {
      res.writeHead(err ? 404 : 200);
      res.end(err ? "not found" : body);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function write(rel, text) {
  const p = path.join(site, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

const started = [];
let server;
try {
  server = await serveBuild();
  const siteUrl = `http://127.0.0.1:${server.address().port}`;

  for (const id of only) {
    const dist = path.join(plugins, id, "dist");
    if (!fs.existsSync(path.join(dist, "manifest.json"))) throw new Error(`plugins/${id}/dist is not built: run npm run build there first`);
    const provider = await import(path.join(here, "providers", `${id}.mjs`));
    console.log(`starting ${id}…`);
    started.push({ id, dist, net: await provider.start({ scratch }) });
  }
  const channels = started.map((s) => s.id);

  write("index.md", "---\ntitle: Home\n---\nA notebook.\n");
  write("notes/notes.md", `---\ntitle: Notes\ncascade:\n  syndicate: [${channels.join(", ")}]\n---\n`);
  write("notes/2026-11-06 1432.md", "Autumn's first hotpot, after a walk along the river. https://example.org/river\n");
  write("notes/2026-11-06 1500.md", "A thread, in three parts.\n\n---\n\nThe second part.\n\n---\n\nAnd the third.\n");
  write("essays/essays.md", `---\ntitle: Essays\ncascade:\n  syndicate: [${channels.join(", ")}]\n---\n`);
  write("essays/on-autumn.md", "---\ntitle: On autumn\ndescription: Why the season reads as an ending and a start.\n---\n" + "The leaves turn. ".repeat(80) + "\n");
  write(".moss/config.toml", `[hooks]\ndeploy = "localdir"\n\n${channels.map((c) => `[channels.${c}]\n`).join("\n")}`);
  write(".moss/plugins/localdir/manifest.json", JSON.stringify({ name: "localdir", version: "0.0.1", display_name: "Local", description: "", author: "", entry: "main.bundle.js", global_name: "LocaldirPlugin", contributes: { deploy_target: {} } }));
  write(".moss/plugins/localdir/main.bundle.js", `globalThis.LocaldirPlugin = { deploy: async () => ({ success: true, deployment: { method: "local", url: ${JSON.stringify(siteUrl)}, deployed_at: new Date().toISOString(), metadata: {} } }) };`);
  for (const s of started) {
    fs.cpSync(s.dist, path.join(site, ".moss/plugins", s.id), { recursive: true });
    fs.writeFileSync(path.join(site, ".moss/plugins", s.id, "config.json"), JSON.stringify(s.net.config));
    for (const [key, value] of Object.entries(s.net.secrets)) await runMoss(["plugin", "secret", "set", s.id, key, site], value);
  }

  const dry = JSON.parse((await runMoss(["deploy", site, "--allow-plugins", "--dry-run", "--json"])).stdout);
  const due = dry.copies.filter((c) => c.action === "due");
  // A loopback address is not one a reader elsewhere can open, so moss gives
  // the site no address of its own and the dry run's links to its pages are
  // paths; the copies link to the address the publish reports.
  const resolve = (t) => t.replace(/(^|\s)(\/\S*)/g, (_, space, p) => space + siteUrl + p);
  for (const c of due) {
    for (const part of c.parts ?? []) part.text = resolve(part.text);
    if (c.link_card) c.link_card.url = resolve(c.link_card.url);
  }
  console.log(`dry run: ${due.length} copies due`);
  for (const c of dry.copies) console.log(`  plan: ${c.channel} ${c.source_path} ${c.action}${c.reason ? ` (${c.reason})` : ""} ${c.form ?? ""}`);
  check(due.length === 3 * channels.length, `the dry run plans three copies per channel (${due.length})`);

  const first = await runMoss(["deploy", site, "--allow-plugins"]);
  for (const line of first.stderr.split("\n").filter((l) => l.includes(" — "))) console.log(`  moss: ${line}`);

  for (const s of started) {
    console.log(`checking ${s.id}…`);
    const mine = due.filter((c) => c.channel === s.id);
    await s.net.verify(mine, check);
    for (const c of mine) {
      const page = fs.readFileSync(path.join(site, c.source_path), "utf8");
      check(s.net.owns(page), `${c.source_path} lists its ${s.id} copy under syndicated:`);
    }
  }

  const counts = await Promise.all(started.map((s) => s.net.count()));
  const second = await runMoss(["deploy", site, "--allow-plugins"]);
  const after = await Promise.all(started.map((s) => s.net.count()));
  started.forEach((s, i) => check(after[i] === counts[i], `a second publish posts nothing to ${s.id} (${counts[i]} → ${after[i]})`));
  check(!/posted to /.test(second.stderr), "a second publish reports no new copy");
} catch (e) {
  failures.push(String(e?.stack ?? e));
  console.error(e);
} finally {
  for (const s of started.reverse()) await s.net.stop().catch((e) => console.error(`stopping ${s.id}: ${e}`));
  server?.close();
  if (!keep) fs.rmSync(scratch, { recursive: true, force: true });
  else console.log(`kept ${scratch}`);
}

console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
