// Identity and naming rules shared by everything that reads or writes the
// registry: the PR validator, the publisher, and the index generator.
//
// These live in one module because the design requires validate and publish to
// agree. If the validator accepts an id the publisher cannot name a tag for, a
// plugin merges and then fails to publish, which is the worst place to find out.
//
// Node builtins only — CI runs these without installing anything.

/** Directory name = manifest.name. Lowercase, digits, hyphens, 3-40 chars. */
export const ID_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** Strict semver. Pre-release and build metadata are allowed but ignored when comparing. */
export const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * A version moss itself can read, as a `min_moss_version` must be: semver
 * without leading zeros, which moss's parser refuses. moss will not run a
 * plugin whose floor it cannot read, so the validator rejects one before it
 * is published.
 */
export const MOSS_VERSION_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Ids that would make a confusing or ambiguous namespace. */
export const RESERVED_IDS = new Set(["moss", "core", "api", "registry", "plugin", "theme"]);

/** Compare semver core versions. Returns 1, 0 or -1. Pre-release tags ignored. */
export function cmpSemver(a, b) {
  const pa = String(a).match(SEMVER_RE);
  const pb = String(b).match(SEMVER_RE);
  if (!pa || !pb) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * The release tag for a version of a package. Release tags — not any committed
 * file — are the version record, which is what keeps the validator and the
 * publisher agreeing even after a partially-failed publish run.
 */
export function tagFor(id, version) {
  return `${id}-v${version}`;
}

/** The zip asset attached to that release. */
export function assetNameFor(id, version) {
  return `${id}-${version}.zip`;
}

/**
 * The icon asset, if the package ships one. Separate from the zip so the
 * catalog can show an icon before anything is installed, without a second
 * origin: it is served from the same release as the artifact it describes.
 */
export function iconAssetPrefixFor(id, version) {
  return `${id}-${version}-icon.`;
}

/**
 * Split a release tag back into id and version, or null if it is not one of
 * ours. Rejects ids the validator would reject, so a hand-pushed tag cannot
 * introduce a package name that could never have passed review.
 */
export function parseReleaseTag(tag) {
  const at = String(tag).lastIndexOf("-v");
  if (at < 1) return null;
  const id = tag.slice(0, at);
  const version = tag.slice(at + 2);
  if (!ID_RE.test(id) || RESERVED_IDS.has(id) || id.startsWith("moss-")) return null;
  if (!SEMVER_RE.test(version)) return null;
  return { id, version };
}

// -------------------------------------------------------------------- kind --
/**
 * What a manifest is, by shape alone: `js` has an `entry`; `native` has none
 * and at least one derivation; `declared` has neither and only says what moss
 * reads from `contributes`. The workflows and the validator all ask here.
 */
export function pluginKind(manifest) {
  if (manifest?.entry !== undefined) return "js";
  const d = manifest?.contributes?.derivations;
  const hasDerivations = d && typeof d === "object" && !Array.isArray(d) && Object.keys(d).length > 0;
  return hasDerivations ? "native" : "declared";
}

// ----------------------------------------------------------------- native --
// A plugin can be only a manifest plus a native program moss downloads and
// runs: no `entry`, one or more `contributes.derivations`, each naming
// `run.artifact` downloads. The source manifest leaves `url` and `sha256` out;
// the publisher fills them from the archives it builds.

/**
 * Platforms a native plugin may build for, with the runner CI builds each on.
 * Each needs `native/build-<platform>.sh`. Linux builds on the oldest Ubuntu
 * runner because the glibc a program is built against is the oldest it runs on.
 */
export const NATIVE_RUNNERS = {
  "darwin-arm64": "macos-15",
  "linux-arm64": "ubuntu-22.04-arm",
  "linux-x64": "ubuntu-22.04",
};
export const NATIVE_PLATFORMS = Object.keys(NATIVE_RUNNERS);

/** Archive formats moss can unpack, as written in `archive_format`. */
export const ARCHIVE_FORMATS = ["tar.gz", "zip"];

/** The script CI calls to build and package one platform's archive. */
export function buildScriptFor(platform) {
  return `build-${platform}.sh`;
}

/** The file name a platform's archive must have: `<id>-<version>-<platform>.<format>`. */
export function nativeArchivePrefixFor(id, version, platform) {
  return `${id}-${version}-${platform}.`;
}

/**
 * Every `run.artifact` entry of every derivation, with where it came from.
 * Pure and tolerant of malformed manifests (returns what is there); judging
 * them is the validator's job.
 */
export function derivationArtifacts(manifest) {
  const out = [];
  const derivations = manifest?.contributes?.derivations;
  if (!derivations || typeof derivations !== "object") return out;
  for (const [derivation, d] of Object.entries(derivations)) {
    const artifacts = d?.run?.artifact;
    if (!Array.isArray(artifacts)) continue;
    artifacts.forEach((artifact, index) => {
      if (artifact && typeof artifact === "object") out.push({ derivation, index, artifact });
    });
  }
  return out;
}

/** Sorted unique platforms of the downloadable artifacts, for the index's `platforms`. */
export function artifactPlatforms(manifest) {
  const platforms = derivationArtifacts(manifest)
    .filter(({ artifact }) => artifact.kind === "download" && typeof artifact.platform === "string")
    .map(({ artifact }) => artifact.platform);
  return [...new Set(platforms)].sort();
}

/**
 * One CI build per plugin and platform: `[{plugin, id, platform, runner}]` for
 * `[{dir, manifest}]`. Platforms without a runner are left out; the validator
 * reports them.
 */
export function nativeBuildMatrix(plugins) {
  return plugins.flatMap(({ dir, manifest }) =>
    artifactPlatforms(manifest)
      .filter((platform) => Object.hasOwn(NATIVE_RUNNERS, platform))
      .map((platform) => ({ plugin: dir, id: dir.split("/").pop(), platform, runner: NATIVE_RUNNERS[platform] })),
  );
}

// ---------------------------------------------------------------- starters --
// A starter version is a release tagged `starter-<id>-v<semver>` with up to
// five assets. These helpers are separate from the plugin ones above on
// purpose: nothing about how plugin tags and assets are named depends on them.

/** Same id grammar scripts/check_starters.py enforces on the folder name. */
export const STARTER_ID_RE = /^[a-z0-9-]+$/;

export function starterTagFor(id, version) {
  return `starter-${id}-v${version}`;
}

/** The source zip: manifest.json, posters/ and site/. */
export function starterSourceAssetFor(id, version) {
  return `${id}-${version}.zip`;
}

/** The built site, without the share-card images. Optional. */
export function starterPreviewAssetFor(id, version) {
  return `${id}-${version}-preview.zip`;
}

/** Which moss built the preview, and the hashes of the zips it describes. Optional. */
export function starterMetaAssetFor(id, version) {
  return `${id}-${version}.json`;
}

/** A standalone copy of one poster, so a picker card needs no zip. scheme: "light" | "dark". */
export function starterPosterAssetFor(id, version, scheme) {
  return `${id}-${version}-poster-${scheme}.jpg`;
}

/** Split `starter-<id>-v<semver>` into id and version, or null. */
export function parseStarterTag(tag) {
  const t = String(tag);
  if (!t.startsWith("starter-")) return null;
  const at = t.lastIndexOf("-v");
  if (at < "starter-".length + 1) return null;
  const id = t.slice("starter-".length, at);
  const version = t.slice(at + 2);
  if (!STARTER_ID_RE.test(id) || !SEMVER_RE.test(version)) return null;
  return { id, version };
}

/**
 * A `requires` entry is one of two shapes. `execute_binary:<basename>` grants
 * exactly one executable; the bare `execute_binary` grants every one of them
 * and is deprecated — moss still honours it, with a warning per run.
 *
 * The basename must be what moss resolves a `binaryPath` down to, so a grant
 * carrying a path separator can never match and is rejected here rather than
 * silently granting nothing.
 */
export const BLANKET_EXECUTE_BINARY = "execute_binary";

const NAMED_EXECUTE_BINARY_RE = /^execute_binary:([^\s:/\\]+)$/;

/** Classify one `requires` entry: `blanket`, `named` (with `binary`), or `unknown`. */
export function classifyRequirement(entry) {
  if (entry === BLANKET_EXECUTE_BINARY) return { kind: "blanket" };
  const named = NAMED_EXECUTE_BINARY_RE.exec(entry);
  if (named) return { kind: "named", binary: named[1] };
  return { kind: "unknown" };
}

/** The grammar, for an error message that tells a contributor what to write. */
export const REQUIRES_GRAMMAR = 'execute_binary:<binary> (e.g. "execute_binary:git"), or the deprecated blanket execute_binary';

const HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const NETWORK_KEYS = new Set(["hosts", "setting_hosts", "site"]);

/**
 * A `network.hosts` entry as moss reads it: a host name with an optional
 * `:<port>`, or a bracketed IPv6 literal with one. Null when it is neither.
 */
function hostEntry(entry) {
  if (typeof entry !== "string") return null;
  const v6 = /^\[([0-9a-f:.]+)\]:(\d+)$/.exec(entry);
  const [, host, port] = v6 ?? /^([^:]*)(?::(\d+))?$/.exec(entry) ?? [];
  if (host === undefined || (v6 ? !URL.canParse(`http://[${host}]/`) : !HOST_RE.test(host))) return null;
  if (port !== undefined && !(/^[1-9]\d*$/.test(port) && Number(port) <= 65535)) return null;
  return { host, port };
}

/**
 * Whether a host pattern names only loopback addresses, as moss decides it:
 * localhost and names under it, 127.0.0.0/8 and 0.0.0.0, in any spelling the
 * URL parser accepts. IPv6 needs no case: it is only written with a port.
 */
function isLoopback(host) {
  const name = host.replace(/^\*\./, "");
  if (!URL.canParse(`http://${name}/`)) return false;
  const h = new URL(`http://${name}/`).hostname;
  return h === "localhost" || h.endsWith(".localhost") || /^127\.\d+\.\d+\.\d+$/.test(h) || h === "0.0.0.0";
}

/** Every setting a manifest declares, by key: its type and whether it is hidden. */
function declaredSettings(manifest) {
  const settings = new Map();
  for (const [key, type] of Object.entries(manifest.config_schema ?? {})) settings.set(key, { type, hidden: false });
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.setup?.settings)) {
      for (const s of node.setup.settings) if (s?.key) settings.set(s.key, { type: s.type, hidden: s.hidden === true });
    }
    for (const child of Object.values(node)) if (child && typeof child === "object" && !Array.isArray(child)) visit(child);
  };
  visit(manifest.contributes);
  return settings;
}

/**
 * What is wrong with a code plugin's `network` declaration, read against its
 * README's "Network access" section. moss reaches only the hosts declared
 * here, so a missing field means the plugin reaches nothing.
 */
export function networkProblems(manifest, readmeSection) {
  const net = manifest.network;
  if (net === undefined) {
    return ['manifest needs a "network" field listing the hosts the plugin contacts, e.g. "network": { "hosts": ["api.example.com"] } (or { "hosts": [] } if it makes no requests); moss refuses every request to a host not listed']; 
  }
  if (!net || typeof net !== "object" || Array.isArray(net)) return ['manifest "network" must be an object: { "hosts": [...], "setting_hosts": [...], "site": true }'];
  const problems = [];
  for (const key of Object.keys(net)) if (!NETWORK_KEYS.has(key)) problems.push(`unknown key in "network": "${key}" (known: hosts, setting_hosts, site)`);
  const hosts = net.hosts ?? [];
  const settingHosts = net.setting_hosts ?? [];
  if (!Array.isArray(hosts)) problems.push('"network.hosts" must be a list of host names');
  if (!Array.isArray(settingHosts)) problems.push('"network.setting_hosts" must be a list of setting keys');
  if (net.site !== undefined && typeof net.site !== "boolean") problems.push('"network.site" must be true or false');
  const text = readmeSection.toLowerCase();
  const entries = (Array.isArray(hosts) ? hosts : []).map((raw) => ({ raw, entry: hostEntry(raw) }));
  const ported = new Set(entries.filter(({ entry }) => entry?.port).map(({ entry }) => entry.host));
  for (const { raw, entry } of entries) {
    if (!entry) {
      problems.push(`"network.hosts" entry ${JSON.stringify(raw)} is not a host name: write "api.example.com", "*.example.com" or "127.0.0.1:5001", with no scheme or path`);
      continue;
    }
    if (!entry.port && isLoopback(entry.host) && !ported.has(entry.host)) {
      problems.push(`"network.hosts" entry "${raw}" is a loopback address with no port, which would reach every service on the person's computer: list it with the port the plugin uses, e.g. "${raw}:5001" (the bare entry may stay beside it, for older moss)`);
    }
    if (!text.includes(entry.host.replace(/^\*\./, ""))) {
      problems.push(`README's "Network access" section does not mention ${entry.host}, which the manifest declares; say what the plugin does there`);
    }
  }
  const settings = declaredSettings(manifest);
  for (const key of Array.isArray(settingHosts) ? settingHosts : []) {
    const setting = settings.get(key);
    if (!setting) problems.push(`"network.setting_hosts" names "${key}", which is not a setting the manifest declares`);
    else if (setting.type !== "string" || setting.hidden) problems.push(`"network.setting_hosts" names "${key}", but only a declared string setting that is neither hidden nor secret, one the person types (in settings or at sign-in), may name a host (it is ${setting.hidden ? "hidden" : setting.type})`);
    else if (!text.includes(key.toLowerCase())) problems.push(`README's "Network access" section does not mention the "${key}" setting, whose host the plugin contacts`);
  }
  return problems;
}
