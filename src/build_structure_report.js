// Builds doc/structure_report.html — the same heatmap browser as report.html, over the
// STRUCTURE set (AI parameters crossed with M and graphAttachment).
//
//   node src/build_structure_report.js
//   node src/build_structure_report.js --metrics capability --out structure_capability.html
//
// A WRAPPER, not a second builder. build_report.js already takes --manifest, --results,
// --stem and --metrics; everything specific to this set is three flag values, and a
// copy of 300 lines would drift from the original the first time either changed. Its
// whole job is to know those three values and to fail helpfully when the results are
// not there yet.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const paths = require("./paths.js");

const MANIFEST = "experiments.structure.manifest.json";
const STEM = "structure";
const DEFAULT_OUT = "structure_report.html";
// Every metric in one dropdown by default: expertise AND capability. The split pages
// (graph-results-*.html) are for opening on one question; this one is for looking.
const DEFAULT_METRICS = "all";

const manifestPath = path.resolve(paths.DATA, MANIFEST);
if (!fs.existsSync(manifestPath)) {
  console.error(`[build_structure_report] no ${MANIFEST} — generate the set first:\n`
    + `  node src/generate_structure_experiments.js`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

// Checked here rather than left to build_report.js's per-experiment skip: with none of
// them present that produces one "not found" line per experiment and then a bare "no
// results" exit, which does not say that the runner has simply never been run.
const missing = manifest.experiments.filter((e) =>
  !fs.existsSync(path.resolve(paths.RESULTS, `${STEM}.${e.n}`, "results_shortfall.csv")));
if (missing.length === manifest.experiments.length) {
  console.error(`[build_structure_report] no results under results/${STEM}.*/ — run them first:\n`
    + `  ./src/run_structure_experiments.sh --workers 16\n\n`
    + `  ${manifest.experiments.length} experiments, `
    + `${manifest.experiments.reduce((s, e) => s + e.runs, 0).toLocaleString()} runs total.`);
  process.exit(1);
}
if (missing.length) {
  console.error(`[build_structure_report] ${missing.length} of ${manifest.experiments.length} experiments have no results yet `
    + `(${missing.map((e) => e.n).join(", ")}) — building from the rest.`);
}

// Caller's flags win: --metrics/--out are passed through, everything else is fixed.
const passthrough = process.argv.slice(2);
const has = (f) => passthrough.includes(f);
const args = [
  path.join(paths.SRC, "build_report.js"),
  "--manifest", MANIFEST,
  "--results", ".",
  "--stem", STEM,
];
if (!has("--metrics")) args.push("--metrics", DEFAULT_METRICS);
if (!has("--out")) args.push("--out", DEFAULT_OUT);
args.push(...passthrough);

const r = spawnSync(process.execPath, args, { stdio: "inherit" });
process.exit(r.status === null ? 1 : r.status);
