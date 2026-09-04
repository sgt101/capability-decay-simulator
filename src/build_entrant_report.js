// Builds doc/entrant_report.html — the same heatmap browser as report.html, over the
// ENTRANT EXPERTISE set: the distribution new arrivals are drawn from, crossed with the
// two AI dials that act on them.
//
//   node src/build_entrant_report.js
//   node src/build_entrant_report.js --metrics all --out entrant_all.html
//
// A WRAPPER, not a second builder — the same arrangement as build_acl_report.js,
// build_structure_report.js and build_recruitment_report.js. build_report.js already takes
// --manifest, --results, --stem and --metrics; everything specific to this set is a handful
// of flag values, and a copy of 600 lines would drift from the original the first time
// either changed.
//
// WHY ITS OWN METRIC SET. Structurally this is an ordinary paired AI sweep: both arms carry
// the same entrant distribution and differ only in aiEnabled, so it does NOT reuse the
// recruitment reading -- two of those panels are meaningless without a hiring freeze
// (headcount is 1.0 everywhere, and capability per head is then the same number as total
// capability). What it does take from that set is the principle: when the swept parameter
// moves the BASELINE a long way, paired changes alone cannot be read. An AI effect of -0.05
// means something different in a field sitting at 0.40 than in one at 0.65, and entrant
// expertise moves the baseline across most of that range. So `--metrics entrant` pairs each
// change panel with the level it happened to.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const paths = require("./paths.js");

const MANIFEST = "experiments.entrant.manifest.json";
const STEM = "entrant";
const DEFAULT_OUT = "entrant_report.html";
const DEFAULT_METRICS = "entrant";

const manifestPath = path.resolve(paths.DATA, MANIFEST);
if (!fs.existsSync(manifestPath)) {
  console.error(`[build_entrant_report] no ${MANIFEST} — generate the set first:\n`
    + `  node src/generate_entrant_experiments.js`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

// Checked here rather than left to build_report.js's per-experiment skip: with none of them
// present that produces one "not found" line per experiment and then a bare "no results"
// exit, which does not say that the runner has simply never been run.
const resultsFor = (n) => path.resolve(paths.RESULTS, `${STEM}.${n}`, "results_shortfall.csv");
const missing = manifest.experiments.filter((e) => !fs.existsSync(resultsFor(e.n)));
if (missing.length === manifest.experiments.length) {
  const runs = manifest.experiments.reduce((s, e) => s + e.runs, 0);
  console.error(`[build_entrant_report] no results under results/${STEM}.*/ — run them first:\n`
    + `  ./src/run_entrant_experiments.sh --workers 16\n\n`
    + `  ${manifest.experiments.length} experiments, ${runs.toLocaleString()} runs total,`
    + ` horizon ${manifest.horizon} ticks (${manifest.horizon / 12} years).`);
  process.exit(1);
}
if (missing.length) {
  console.error(`[build_entrant_report] ${missing.length} of ${manifest.experiments.length} experiments have no results yet `
    + `(${missing.map((e) => e.n).join(", ")}) — building from the rest.`);
}

// Half of this report's panels are absolute LEVELS from the baseline arm, which is the
// whole reason the set has its own metric reading. A results file that predates the
// _baseline/_treatment columns would silently drop those panels and still produce a page:
// a report with only the change panels looks complete and answers a different question.
const present = manifest.experiments.filter((e) => fs.existsSync(resultsFor(e.n)));
const stale = present.filter((e) => {
  const header = fs.readFileSync(resultsFor(e.n), "utf8").slice(0, 8192).split("\n")[0].split(",");
  return !header.includes("meanE_baseline") || !header.includes("systemCapability_baseline");
});
if (stale.length) {
  console.error(`[build_entrant_report] ${stale.length} result set(s) carry no _baseline columns `
    + `(${stale.map((e) => e.n).join(", ")}).\n`
    + `  Half of this report is absolute levels read from the no-AI arm, so those panels\n`
    + `  would be blank. Re-run them:\n`
    + `    ./src/run_entrant_experiments.sh ${stale[0].n}`);
  process.exit(1);
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
