// Prints the CI build matrix for native plugins, one entry per platform each
// manifest declares, as JSON for a workflow's `strategy.matrix.include`.
//
//   node .github/scripts/native-matrix.mjs plugins/<id> [plugins/<id> ...]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nativeBuildMatrix } from "./registry-rules.mjs";

const plugins = process.argv.slice(2).map((dir) => ({
  dir: dir.replace(/\/+$/, ""),
  manifest: JSON.parse(readFileSync(join(dir, "assets", "manifest.json"), "utf8")),
}));
process.stdout.write(JSON.stringify(nativeBuildMatrix(plugins)) + "\n");
