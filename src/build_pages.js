// Assembles site/ — a self-contained copy of the simulator ready for GitHub Pages.
//
//   node src/build_pages.js
//
// The simulator is already a static page with no build step, so this exists for one
// reason: it loads ../data/world-model-data.js, a path that reaches OUT of the
// directory it sits in. Publishing src/ alone would silently drop the world model and
// leave the page on the generated BA graph — it degrades rather than failing, which is
// the worst way for this to go wrong. The copy flattens that one path.
//
// Deliberately NOT publishing the whole repository root. That would work (the relative
// paths resolve as-is) but the entry point would be /src/simulator.html and every
// source file would be served alongside it. Four files and an index.html is a smaller
// thing to reason about.
"use strict";
const fs = require("fs");
const path = require("path");
const paths = require("./paths.js");

const OUT = path.join(paths.ROOT, "site");

// [source, destination]. Destinations are flat except for data/, which is kept as a
// directory so the rewrite below is one path rather than several.
const ASSETS = [
  [paths.src("engine.js"), "engine.js"],
  [paths.src("world_model.js"), "world_model.js"],
  [paths.data("world-model-data.js"), "data/world-model-data.js"],
];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "data"), { recursive: true });

let html = fs.readFileSync(paths.src("simulator.html"), "utf8");

// The one rewrite. Asserted rather than assumed: if the page stops referencing the
// world model by this path, a silent no-op here would publish a simulator that quietly
// runs without it.
const FROM = '<script src="../data/world-model-data.js"></script>';
const TO = '<script src="data/world-model-data.js"></script>';
if (!html.includes(FROM)) {
  console.error(`[build_pages] simulator.html no longer contains ${FROM}`);
  console.error(`  The world-model script path has changed — update ASSETS and this rewrite.`);
  process.exit(1);
}
html = html.replace(FROM, TO);

// Every <script src> in the published page must exist in the published tree. This is
// the check that matters: the page loads its dependencies at runtime, so a missing one
// is not a build error, it is a broken site that still renders.
const referenced = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const shipped = new Set(ASSETS.map(([, dest]) => dest));
const orphans = referenced.filter((r) => !shipped.has(r));
if (orphans.length) {
  console.error(`[build_pages] the page loads scripts that are not being published: ${orphans.join(", ")}`);
  process.exit(1);
}

fs.writeFileSync(path.join(OUT, "index.html"), html);
ASSETS.forEach(([src, dest]) => {
  if (!fs.existsSync(src)) {
    console.error(`[build_pages] missing ${src} — run: node src/build_world_model_data.js`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(OUT, dest));
});

// Without this, Pages runs the tree through Jekyll, which ignores files and folders
// beginning with an underscore and can rewrite what it thinks is templating.
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

const total = [["index.html"], ...ASSETS.map(([, d]) => [d])]
  .reduce((s, [f]) => s + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`wrote site/ — ${referenced.length + 1} files, ${(total / 1024).toFixed(0)} KB`);
console.log(`  index.html  (simulator.html, world-model path flattened)`);
ASSETS.forEach(([, d]) => console.log(`  ${d}`));
console.log(`\npreview locally:  npx serve site    (or: cd site && python3 -m http.server)`);
