// Prints `js`, `native` or `declared` for a plugin directory, so the workflows
// read the kind from registry-rules.mjs `pluginKind` and not from a copy of it.
// A manifest that will not parse prints `js`, where the validator reports it.
//
//   node .github/scripts/plugin-kind.mjs plugins/<id>

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pluginKind } from "./registry-rules.mjs";

let manifest = null;
try {
  manifest = JSON.parse(readFileSync(join(process.argv[2] ?? "", "assets", "manifest.json"), "utf8"));
} catch {}
process.stdout.write((manifest === null ? "js" : pluginKind(manifest)) + "\n");
