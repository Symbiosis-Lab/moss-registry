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
