// Runs one safety mutation at a time, requires a test failure, restores the source bytes, then requires green.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cases = [
  ["origin", "api.ts", 'api !== API && !/^http:', 'false && api !== API && !/^http:', "guards origin before reading secrets"],
  ["token", "api.ts", 'if (!token) throw', 'if (false) throw', "refuses missing credentials"],
  ["redirect", "api.ts", 'redirect: "error"', 'redirect: "follow"', "does not follow HTTP"],
  ["redaction", "api.ts", 'const message = `Threads API refused the request (HTTP ${r.status})`;', 'const message = data.error.message;', "without leaking secrets"],
  ["id", "api.ts", 'if (typeof data?.id !== "string" || !/^\\d+$/.test(data.id)) throw', 'if (false) throw', "throws when successful publication returns no id"],
  ["deletion-confirmation", "api.ts", 'result?.success !== true', 'false', "throws when rollback is false"],
  ["readiness", "main.ts", 'await ready(a, container);', '// readiness bypassed', "refuses readiness"],
  ["bounded-wait", "api.ts", 'attempt < 5', 'attempt < 6', "refuses readiness IN_PROGRESS"],
  ["unknown-status", "api.ts", 'if (result?.status !== "IN_PROGRESS") throw', 'if (false) throw', "refuses readiness UNRECOGNIZED"],
  ["failed-status", "api.ts", '["ERROR", "EXPIRED"].includes(result?.status)', 'false', "refuses readiness ERROR"],
  ["length", "main.ts", 'p.text.length > 500', 'false', "refuses invalid shaped content"],
  ["rollback-order", "main.ts", '[...posted].reverse()', '[...posted]', "rolls back partial threads in reverse order"],
  ["rollback", "main.ts", 'for (const published of [...posted].reverse()) await remove(a, published);', '// rollback bypassed', "rolls back partial threads in reverse order"],
  ["publish-uncertainty", "main.ts", 'if (!(e instanceof Refusal)) throw e;', '// uncertainty bypassed', "throws on uncertain publication"],
  ["later-transport", "main.ts", 'if (posted.length && !(e instanceof Refusal)) throw e;', '// prefix uncertainty bypassed', "throws on later container transport loss"],
  ["rollback-failure", "main.ts", 'await remove(a, published);', 'await remove(a, published).catch(() => {});', "throws when rollback is fail"],
  ["bounded-absence", "main.ts", 'if (matches.length !== 1) throw', 'if (!matches.length) return { success: true, copy: null }; if (matches.length !== 1) throw', "throws for absent recovery"],
  ["lookup-uncertainty", "main.ts", 'for (const published of posted) posts.push(await call(a, "GET", `/${published}?fields=${fields}`));', 'try { for (const published of posted) posts.push(await call(a, "GET", `/${published}?fields=${fields}`)); } catch (e) { return refusal(e); }', "throws even on explicit refusal during post-publication lookup"],
  ["unique-recovery", "main.ts", 'matches.length !== 1', 'matches.length === 0', "throws for duplicate recovery"],
  ["reply-chain", "main.ts", 'p.is_reply === true && p.replied_to?.id === parent', 'p.is_reply === true', "throws for unknown-parent recovery"],
  ["extra-replies", "main.ts", 'posts.some((p) => p.replied_to?.id === chain[chain.length - 1].id)', 'false', "throws for extra recovery"],
  ["permalink", "main.ts", 'typeof p.permalink !== "string" || !/^https:', 'false && typeof p.permalink !== "string" || false && !/^https:', "rejects an invalid permalink"],
];
const selected = new Set(process.argv.slice(2));
for (const name of selected) if (!cases.some(([id]) => id === name)) throw new Error(`Unknown ablation: ${name}`);
const log = [`Invocation: node plugins/threads/scripts/ablate.mjs ${[...selected].join(" ")}`];
const run = (pattern) => {
  const args = ["test", "--", "-t", pattern];
  const r = spawnSync("npm", args, { cwd: root, encoding: "utf8", timeout: 30_000 });
  log.push(`$ npm test -- -t ${JSON.stringify(pattern)}\nexit ${r.status}\n${r.stdout}${r.stderr}`);
  if (r.error) throw r.error;
  return r;
};
try {
  for (const [name, file, before, after, pattern] of cases.filter(([name]) => !selected.size || selected.has(name))) {
    const target = path.join(root, "src", file);
    const original = fs.readFileSync(target, "utf8");
    if (!original.includes(before)) throw new Error(`${name}: mutation target missing`);
    let broken;
    try { fs.writeFileSync(target, original.replaceAll(before, after)); broken = run(pattern); }
    finally { fs.writeFileSync(target, original); }
    const restored = run(pattern);
    if (broken.status !== 1 || !/FAIL/.test(broken.stdout + broken.stderr) || restored.status !== 0) throw new Error(`${name}: expected mutant exit 1 and restored exit 0`);
    console.log(`${name}: mutant 1, restored 0`);
  }
} finally {
  const scratch = process.env.TMPDIR;
  if (scratch) fs.appendFileSync(path.join(scratch, "threads-ablations.log"), "\n" + log.join("\n"));
}
