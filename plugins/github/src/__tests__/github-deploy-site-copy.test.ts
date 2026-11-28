/**
 * deployViaGitPush against real git: a project repo whose pushes land in a
 * local bare repo, and a site copy outside the project, as moss hands it over.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";

let projectDir = "";

vi.mock("../utils", () => ({ showToast: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@symbiosis-lab/moss-api", () => ({
  listSiteFilesWithSizes: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
  executeBinary: vi.fn(async (o: { binaryPath: string; args: string[]; workingDir?: string; env?: Record<string, string>; stdin?: string }) => {
    const r = spawnSync(o.binaryPath, o.args, {
      cwd: o.workingDir && isAbsolute(o.workingDir) ? o.workingDir : join(projectDir, o.workingDir ?? "."),
      env: { ...cleanEnv(), ...o.env },
      input: o.stdin,
      encoding: "utf8",
    });
    return { success: r.status === 0, exitCode: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }),
}));

import { deployViaGitPush } from "../github-deploy";

const TOKEN = "tok";
const OWNER = "o";
const REPO = "r";

/** The environment without GIT_*, which a git hook running this suite would leak in. */
function cleanEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter(([k, v]) => !k.startsWith("GIT_") && v !== undefined)) as Record<string, string>;
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, env: cleanEnv(), encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

describe("deployViaGitPush with moss's site copy", () => {
  let root = "";
  let bare = "";
  let siteDir = "";
  let indexFile = "";
  const SITE = { "index.html": "<h1>home</h1>", "css/site.css": "body{}", "notes/café [1].html": "<p>x</p>" };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "moss-gh-copy-"));
    projectDir = join(root, "project");
    bare = join(root, "remote.git");
    siteDir = join(root, "scratch", "gen-1");
    indexFile = join(root, "scratch", "gen-1.index");
    git(root, "init", "-q", "--bare", bare);

    mkdirSync(projectDir);
    git(projectDir, "init", "-q");
    git(projectDir, "config", "user.email", "moss@symbiosis-lab.com");
    git(projectDir, "config", "user.name", "moss");
    git(projectDir, "remote", "add", "origin", `https://github.com/${OWNER}/${REPO}.git`);
    git(projectDir, "config", `url.file://${bare}.insteadOf`, `https://github.com/${OWNER}/${REPO}.git`);
    git(projectDir, "config", "--add", `url.file://${bare}.insteadOf`, `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`);
    writeFileSync(join(projectDir, "index.md"), "# home\n");
    git(projectDir, "add", "index.md");

    for (const [path, body] of Object.entries(SITE)) {
      mkdirSync(join(siteDir, path, ".."), { recursive: true });
      writeFileSync(join(siteDir, path), body);
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const deploy = (siteFiles: string[]) =>
    deployViaGitPush({ owner: OWNER, repo: REPO, token: TOKEN, onProgress: () => {}, gitPath: "git", siteFiles, siteDir, indexFile });

  const remoteFiles = (ref: string) => git(bare, "ls-tree", "-r", "-z", "--name-only", ref).split("\0").filter(Boolean).sort();

  it("pushes exactly the copy to gh-pages and keeps it out of the project's index and main", async () => {
    await deploy(Object.keys(SITE));

    expect(remoteFiles("gh-pages")).toEqual([".nojekyll", ...Object.keys(SITE)].sort());
    expect(git(projectDir, "ls-files", "-z").split("\0").filter(Boolean)).toEqual(["index.md"]);
    expect(remoteFiles("main")).toEqual(["index.md"]);
  });

  it("keeps the copy out of main where moss puts it today, under the gitignored .moss/build.nosync/", async () => {
    const scratch = join(projectDir, ".moss", "build.nosync", "deploy");
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(projectDir, ".moss", ".gitignore"), "build.nosync/\ncache/\n");
    renameSync(siteDir, join(scratch, "gen-1"));
    siteDir = join(scratch, "gen-1");
    indexFile = join(scratch, "gen-1.index");

    await deploy(Object.keys(SITE));

    expect(remoteFiles("gh-pages")).toEqual([".nojekyll", ...Object.keys(SITE)].sort());
    expect(remoteFiles("main")).toEqual([".moss/.gitignore", "index.md"]);
  });

  it("pushes nothing when a listed file has gone from the copy", async () => {
    rmSync(join(siteDir, "css/site.css"));

    await expect(deploy(Object.keys(SITE))).rejects.toThrow(/nothing was pushed \(missing: css\/site\.css/);
    expect(git(bare, "for-each-ref", "--format=%(refname)")).toBe("");
  });
});
