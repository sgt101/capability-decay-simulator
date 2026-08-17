// Where things live. ONE definition, imported by every Node script, so a future
// move needs one edit rather than a grep across twelve files.
//
// Node-only. Deliberately NOT loaded by the browser: engine.js and world_model.js
// are dual-mode (Node require + classic <script src>), this is not — simulator.html
// reaches data/ with a relative src instead. Adding a require() of this file to
// either of those two would break the page.
//
// The layout it describes:
//
//   src/      code, including src/test/ and the two HTML pages
//   data/     inputs — world-model.json, mobility-costs.json, experiment configs,
//             manifests. Hand-maintained or generated FROM hand-maintained files.
//   results/  outputs — regenerable. Nothing here is a source of truth.
//   doc/      prose, spec.html, and the built report.html
//   tmp/      scratch, gitignored
//
// data/ vs results/ is the distinction worth preserving: everything in results/
// can be rebuilt by re-running the study, nothing in data/ can.
"use strict";
const path = require("path");

const SRC = __dirname;
const ROOT = path.resolve(SRC, "..");

const join = (base) => (...parts) => path.join(base, ...parts);

module.exports = {
  ROOT,
  SRC,
  DATA: path.join(ROOT, "data"),
  RESULTS: path.join(ROOT, "results"),
  DOC: path.join(ROOT, "doc"),
  TMP: path.join(ROOT, "tmp"),
  // Path builders: paths.data("world-model.json"), paths.results("experiment.3", "results.csv")
  data: join(path.join(ROOT, "data")),
  results: join(path.join(ROOT, "results")),
  doc: join(path.join(ROOT, "doc")),
  tmp: join(path.join(ROOT, "tmp")),
  src: join(SRC),
};
