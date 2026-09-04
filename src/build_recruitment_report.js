// Builds doc/recruitment_report.html — the same heatmap browser as report.html, over the
// RECRUITMENT SHOCK set: a hiring freeze applied to a field already at equilibrium.
//
//   node src/build_recruitment_report.js
//   node src/build_recruitment_report.js --metrics capability --out recruitment_capability.html
//
// A WRAPPER, not a second builder — the same arrangement as build_acl_report.js and
// build_structure_report.js. build_report.js already takes --manifest, --results, --stem
// and --metrics; everything specific to this set is a handful of flag values, and a copy
// of 600 lines would drift from the original the first time either changed. This file's
// job is to know those values, to default to the right metric set, and to fail helpfully
// when the results are not there yet.
//
// WHY ITS OWN METRIC SET. Every other set pairs AI-on against AI-off in an otherwise
// identical world, so the paired _change columns are the whole story. Here BOTH arms
// carry the same freeze: _change still isolates AI, but the freeze's own damage lives in
// the absolute level of the no-AI arm, which no paired column can show. `--metrics
// recruitment` (the default here) therefore mixes the two — levels from the baseline arm
// for what the freeze did, changes for what AI did on top of it.
//
// AND WHY meanE IS NOT THE HEADLINE. A freeze removes ENTRANTS, who are the least expert
// people in the field, so mean expertise per surviving person barely moves and can even
// rise while the field is hollowed out. The panels to read together are "Headcount
// retained" and "Capability per head": a flat capability-per-head over a falling headcount
// is a smaller field doing proportionally the same work; a falling one is a field that has
// lost its ladder as well as its people.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const paths = require("./paths.js");

const MANIFEST = "experiments.recruitment.manifest.json";
const STEM = "recruitment";
const DEFAULT_OUT = "recruitment_report.html";
const DEFAULT_METRICS = "recruitment";

const manifestPath = path.resolve(paths.DATA, MANIFEST);
if (!fs.existsSync(manifestPath)) {
  console.error(`[build_recruitment_report] no ${MANIFEST} — generate the set first:\n`
    + `  node src/generate_recruitment_experiments.js`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

// Checked here rather than left to build_report.js's per-experiment skip: with none of
// them present that produces one "not found" line per experiment and then a bare "no
// results" exit, which does not say that the runner has simply never been run.
const missing = manifest.experiments.filter((e) =>
  !fs.existsSync(path.resolve(paths.RESULTS, `${STEM}.${e.n}`, "results_shortfall.csv")));
if (missing.length === manifest.experiments.length) {
  const runs = manifest.experiments.reduce((s, e) => s + e.runs, 0);
  console.error(`[build_recruitment_report] no results under results/${STEM}.*/ — run them first:\n`
    + `  ./src/run_recruitment_experiments.sh\n\n`
    + `  ${manifest.experiments.length} experiments, ${runs.toLocaleString()} runs total.\n`
    + `  These runs are LONGER than the other sets: the horizon is ${manifest.horizon} ticks\n`
    + `  (${manifest.horizon / 12} years), because the freeze lands at t=${manifest.shockStart} — past the\n`
    + `  entrant-pipeline transient — and then needs a century of aftermath to be worth reading.`);
  process.exit(1);
}
if (missing.length) {
  console.error(`[build_recruitment_report] ${missing.length} of ${manifest.experiments.length} experiments have no results yet `
    + `(${missing.map((e) => e.n).join(", ")}) — building from the rest.`);
}

// A results file that predates the recruitment mechanism has no activeFraction column,
// and three of the six metrics on this page are built from it. build_report.js would drop
// those panels and still produce a page, which is the wrong failure: a recruitment report
// with no headcount panel looks complete and is not.
const present = manifest.experiments.filter((e) =>
  fs.existsSync(path.resolve(paths.RESULTS, `${STEM}.${e.n}`, "results_shortfall.csv")));
const stale = present.filter((e) => {
  const f = path.resolve(paths.RESULTS, `${STEM}.${e.n}`, "results_shortfall.csv");
  const header = fs.readFileSync(f, "utf8").slice(0, 8192).split("\n")[0];
  return !header.split(",").includes("activeFraction_baseline");
});
if (stale.length) {
  console.error(`[build_recruitment_report] ${stale.length} result set(s) carry no activeFraction column `
    + `(${stale.map((e) => e.n).join(", ")}).\n`
    + `  They predate the recruitment mechanism in engine.js and cannot show headcount or\n`
    + `  capability per head — the two panels this report exists for. Re-run them:\n`
    + `    ./src/run_recruitment_experiments.sh ${stale[0].n}`);
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
