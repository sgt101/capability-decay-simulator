// Bundles world-model.json + mobility-costs.json into world-model-data.js, a plain
// script that simulator.html can <script src> so the world-model graph is available
// the moment the page opens.
//
// Why a generated .js and not fetch(): the simulator is opened straight off the
// filesystem, and at file:// a fetch/XHR for a sibling file is blocked (origin
// "null") in every current browser. A classic <script src> is not — which is already
// how engine.js and world_model.js get in. So the data has to arrive as script text.
//
//   node src/build_world_model_data.js            # regenerate
//   node src/build_world_model_data.js --check    # verify it matches its sources (CI/tests)
//
// world-model.json is EXPECTED to change — see its fingerprint machinery — so the
// copy here goes stale by design. test_world_model.js runs the --check path, so a
// stale bundle fails the suite rather than quietly serving last month's world.
"use strict";
const fs = require("fs");
const path = require("path");
const paths = require("./paths.js");

const SOURCES = { world: "world-model.json", costs: "mobility-costs.json" };
const OUT = "world-model-data.js";

const read = (f) => JSON.parse(fs.readFileSync(paths.data(f), "utf8"));
const canonical = (o) => JSON.stringify(o);

function render() {
  const world = read(SOURCES.world);
  const costs = read(SOURCES.costs);
  return [
    "// GENERATED FILE — do not edit by hand.",
    `// Regenerate with:  node ${path.basename(__filename)}`,
    `// Sources: ${SOURCES.world}, ${SOURCES.costs}`,
    "//",
    "// simulator.html loads this so the world model is ready without hand-picking the",
    "// two files. It is optional: if it is missing, the page falls back to the file",
    "// inputs in the sidebar and runs on the generated BA graph until you use them.",
    "globalThis.WORLD_MODEL_DATA = {",
    "  world: " + canonical(world) + ",",
    "  costs: " + canonical(costs) + ",",
    "};",
    "",
  ].join("\n");
}

const outPath = paths.data(OUT);

if (process.argv.includes("--check")) {
  let current = null;
  try { current = fs.readFileSync(outPath, "utf8"); } catch (e) { /* missing */ }
  if (current !== render()) {
    console.error(`[world-model-data] ${OUT} is missing or stale — run: node ${path.basename(__filename)}`);
    process.exit(1);
  }
  console.log(`[world-model-data] ${OUT} matches its sources`);
  process.exit(0);
}

const text = render();
fs.writeFileSync(outPath, text);
console.log(`[world-model-data] wrote ${OUT} (${(text.length / 1024).toFixed(0)} KB) from ${SOURCES.world} + ${SOURCES.costs}`);
