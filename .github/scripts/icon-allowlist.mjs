// What moss keeps of a published icon; anything else is stripped before drawing.
// A copy of ALLOWED_TAGS and ALLOWED_ATTRS in public moss, kept equal by the
// test in validate-plugin.test.mjs, which reads them from moss's develop branch.
export const MOSS_ICON_RS =
  "https://raw.githubusercontent.com/Symbiosis-Lab/moss/develop/crates/moss-build/src/plugins/install/registry_client/icon.rs";

export const ICON_TAGS = new Set(["svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "title",
  "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask"]);
export const ICON_ATTRS = new Set(["viewBox", "xmlns", "width", "height", "fill", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-dasharray", "stroke-opacity", "fill-opacity", "fill-rule", "clip-rule", "opacity", "d",
  "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "points", "transform", "offset", "stop-color",
  "stop-opacity", "gradientUnits", "id", "clip-path", "mask"]);

// Plugins whose icon moss cannot draw yet, each with what it waits on. Their icon
// problems are notes, not failures, so a sync from moss never blocks on them; an
// entry whose icon has become drawable fails until it is removed.
export const ICON_EXEMPT = new Map([
  ["onionpress", "its only mark is a PNG in <image>, which moss draws blank, until a vector mark replaces it"],
]);

/** How these lists differ from the ones in `source` (icon.rs), one line each; empty when equal. */
export function allowlistDrift(source) {
  const read = (name) => {
    const body = source.match(new RegExp(`const ${name}: &\\[&str\\] = &\\[([^\\]]*)\\];`))?.[1];
    if (body === undefined) return null;
    return new Set([...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  };
  const lines = [];
  for (const [name, ours] of [["ALLOWED_TAGS", ICON_TAGS], ["ALLOWED_ATTRS", ICON_ATTRS]]) {
    const theirs = read(name);
    if (!theirs) { lines.push(`${name} not found in icon.rs`); continue; }
    for (const v of theirs) if (!ours.has(v)) lines.push(`${name}: moss keeps "${v}", the registry rejects it`);
    for (const v of ours) if (!theirs.has(v)) lines.push(`${name}: moss strips "${v}", the registry allows it`);
  }
  return lines;
}
