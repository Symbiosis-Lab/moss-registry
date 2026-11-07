/**
 * The onionpress plugin as moss runs it: `moss deploy` on a real site with the
 * plugin installed from dist/, against a stub receiver on loopback that speaks
 * the wire contract src/receiver.ts calls (GET status, POST generation, POST commit).
 *
 * Run: MOSS_BINARY=/path/to/moss npx vitest run --project e2e
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { RECEIVER_API_PATH, RECEIVER_PORTS } from "../src/constants";

const MOSS_BINARY = process.env.MOSS_BINARY;
if (!MOSS_BINARY) console.warn("onionpress e2e skipped: set MOSS_BINARY to a moss CLI binary");

const PLUGIN_DIST = path.join(__dirname, "../dist");
const ONION_URL = "http://stubreceiverstubreceiverstubreceiverstubreceiverstubreceiver.onion/";

let testDir: string;
let home: string;
let server: http.Server | undefined;
let port: number | undefined;
let skipReason: string | undefined;
let siteCounter = 0;

interface Seen {
  generationQuery?: string;
  uploaded: Buffer[];
  commitBody?: string;
}
const seen: Seen = { uploaded: [] };

function listen(srv: http.Server, p: number): Promise<boolean> {
  return new Promise((resolve) => {
    srv.once("error", () => resolve(false));
    srv.listen(p, "127.0.0.1", () => resolve(true));
  });
}

/** Is something on this port already answering like an OnionPress receiver? */
async function isRealReceiver(p: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${p}${RECEIVER_API_PATH}/status`, {
      signal: AbortSignal.timeout(1500),
    });
    return "receiver_version" in ((await res.json()) as object);
  } catch {
    return false;
  }
}

function stubReceiver(): http.Server {
  return http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const json = (body: object) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      };
      if (req.method === "GET" && url.pathname === `${RECEIVER_API_PATH}/status`) {
        // 1.2 selects the multipart carrier; onion_reachable true ends the reachability poll at once.
        return json({
          receiver_version: "1.2",
          onion_address: "stub.onion",
          current_generation: null,
          onion_reachable: true,
          onion_http_code: "200",
        });
      }
      if (req.method === "POST" && url.pathname === `${RECEIVER_API_PATH}/generation`) {
        seen.generationQuery = url.search;
        seen.uploaded.push(Buffer.concat(chunks));
        return json({ ok: true });
      }
      if (req.method === "POST" && url.pathname === `${RECEIVER_API_PATH}/commit`) {
        seen.commitBody = Buffer.concat(chunks).toString();
        return json({ ok: true, url: ONION_URL });
      }
      res.statusCode = 404;
      res.end();
    });
  });
}

function createSite(): string {
  const site = path.join(testDir, `site-${siteCounter++}`);
  const pluginDir = path.join(site, ".moss", "plugins", "onionpress");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(site, "index.md"), "# Hello onion\n\nPublished over Tor.\n");
  for (const file of fs.readdirSync(PLUGIN_DIST)) {
    fs.copyFileSync(path.join(PLUGIN_DIST, file), path.join(pluginDir, file));
  }
  // `environment` makes the folder "a site" to deploy; `[hooks] deploy` routes the publish to the plugin.
  fs.writeFileSync(
    path.join(site, ".moss", "config.toml"),
    'environment = "local"\n\n[hooks]\ndeploy = "onionpress"\n',
  );
  return site;
}

function moss(args: string[]): Promise<{ output: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(MOSS_BINARY!, args, {
      cwd: testDir,
      timeout: 90_000,
      env: { ...process.env, HOME: home, CI: "true" },
    });
    let output = "";
    proc.stdout?.on("data", (d) => (output += d));
    proc.stderr?.on("data", (d) => (output += d));
    proc.on("close", (code) => resolve({ output, code: code ?? 1 }));
    proc.on("error", (err) => resolve({ output: output + err.message, code: 1 }));
  });
}

describe.skipIf(!MOSS_BINARY)("onionpress plugin through moss deploy", () => {
  beforeAll(async () => {
    if (!fs.existsSync(path.join(PLUGIN_DIST, "main.bundle.js"))) {
      throw new Error(`Plugin dist missing at ${PLUGIN_DIST}; run 'npm run build' first.`);
    }
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "moss-onionpress-e2e-"));
    home = path.join(testDir, "home");
    fs.mkdirSync(home);

    // The plugin deploys to the FIRST port in the list that answers as a
    // receiver. Take the first port we can bind, and refuse to run when a real
    // OnionPress sits on an earlier one: the plugin would publish to it.
    for (const p of RECEIVER_PORTS) {
      const srv = stubReceiver();
      if (await listen(srv, p)) {
        server = srv;
        port = p;
        return;
      }
      if (await isRealReceiver(p)) {
        skipReason = `a receiver is already running on port ${p}`;
        return;
      }
    }
    skipReason = `no free port among ${RECEIVER_PORTS.join(", ")}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
    if (testDir) fs.rmSync(testDir, { recursive: true, force: true });
  });

  async function deployToStub(bridgeBuildDir: boolean) {
    const site = createSite();
    // The plugin reads the build from `.moss/build/current` (src/constants.ts);
    // current moss writes `.moss/build.nosync/current`.
    if (bridgeBuildDir) fs.symlinkSync("build.nosync", path.join(site, ".moss", "build"));
    return moss(["deploy", site, "--allow-plugins"]);
  }

  function skipIfNoStub(ctx: { skip: () => never }) {
    if (!skipReason) return;
    console.warn(`onionpress deploy case skipped: ${skipReason}`);
    ctx.skip();
  }

  it("uploads the build to the receiver, commits it, and moss reports the onion address", async (ctx) => {
    skipIfNoStub(ctx);
    const { output, code } = await deployToStub(true);

    expect(code, output).toBe(0);

    // The upload is the built site, as a tar of the generation's contents.
    expect(seen.uploaded).toHaveLength(1);
    const upload = seen.uploaded[0].toString("latin1");
    expect(upload).toContain("index.html");
    expect(upload).toContain("Hello onion");

    // The commit names the generation that was uploaded.
    const genId = new URLSearchParams(seen.generationQuery).get("id");
    expect(genId).toMatch(/^moss-\d+$/);
    expect(JSON.parse(seen.commitBody ?? "{}")).toEqual({ generation: genId });

    expect(output).toContain(ONION_URL);
  });

  // Known plugin bug: without the bridge, tar cannot find the build. Expected
  // to fail until src/constants.ts follows moss's build directory; then this
  // test starts passing, vitest reports it, and the bridge above can go.
  it.fails("deploys with no bridge between the plugin's build path and moss's", async (ctx) => {
    skipIfNoStub(ctx);
    const { code } = await deployToStub(false);
    expect(code).toBe(0);
  });
});
