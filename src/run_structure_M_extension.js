#!/usr/bin/env node
// Runs ONLY the newly-added high-M rows of the structure set and merges them into the
// results that are already on disk — so `node src/generate_structure_experiments.js`
// can grow the M axis without the whole ~190k-run set being recomputed.
//
//   node src/run_structure_M_extension.js                 # every experiment that sweeps M
//   node src/run_structure_M_extension.js --workers 14
//   node src/run_structure_M_extension.js --only 1,3,5    # just those experiment numbers
//   node src/run_structure_M_extension.js --dry-run       # print what would run, do nothing
//   node src/run_structure_M_extension.js --force         # re-run + re-append even if the
//                                                         #   rows look already merged
//   node src/run_structure_M_extension.js --replicates 2  # cheap pipeline check (the merged
//                                                         #   grid then fails build_report's
//                                                         #   replicate count — for testing only)
//
// Per experiment whose x or y axis is M (structure.1/3/5/7/9): clone
// data/experiments-structure/structure.N.json with params.M.values cut to just the tail
// values (EXTRA_M below), run it through batch_run.js, and append the rows onto the
// matching CSVs in results/structure.N/. Recompile with ./src/build_reports.sh after.
//
// NOT bit-identical to a full re-run. batch_run derives each run's seed from its combo
// INDEX in the Cartesian product (batch_run.js, buildJobs), and a 6-value M sweep indexes
// its cells differently from a 26-value one — a tail cell here uses a different seed than
// `--redo` on the whole set would. The 32-replicate mean is unbiased; only the noise
// draw differs. The `comboIndex` column in the merged results.csv / results_summary.csv
// is likewise no longer globally unique (build_report keys on the axis values, not
// comboIndex, so its output is unaffected).
"use strict";
const fs = require("fs");
const path = require("path");
const paths = require("./paths.js");
const { mColumnHasAny, runAndMerge } = require("./structure_merge.js");

// The linear tail added to generate_structure_experiments.js's M axis (M_TAIL there).
const EXTRA_M = [175, 225, 275, 325, 375, 425];

const argVal = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const has = (f) => process.argv.includes(f);
const DRY = has("--dry-run"), FORCE = has("--force");
const WORKERS = argVal("--workers");
const REPLICATES = argVal("--replicates") ? Number(argVal("--replicates")) : null;
const ONLY = argVal("--only") ? new Set(argVal("--only").split(",").map((s) => Number(s.trim()))) : null;

const MANIFEST = path.join(paths.DATA, "experiments.structure.manifest.json");
if (!fs.existsSync(MANIFEST)) {
  console.error(`no ${path.relative(paths.ROOT, MANIFEST)} — run node src/generate_structure_experiments.js first`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const targets = manifest.experiments.filter((e) => (e.x === "M" || e.y === "M") && (!ONLY || ONLY.has(e.n)));
if (!targets.length) {
  console.error(ONLY ? `--only matched no M-axis experiment` : "no experiment in the manifest sweeps M");
  process.exit(1);
}

console.log(`structure M-axis extension: ${EXTRA_M.join(", ")}`);
console.log(`${targets.length} experiment(s): ${targets.map((e) => e.n).join(", ")}${DRY ? "   (dry run)" : ""}\n`);

let merged = 0, skipped = 0, failed = 0;

for (const entry of targets) {
  const tag = `structure.${entry.n}`;
  const cfg = JSON.parse(fs.readFileSync(path.join(paths.DATA, "experiments-structure", `${tag}.json`), "utf8"));
  const shortfall = path.join(paths.RESULTS, tag, "results_shortfall.csv");

  const newM = EXTRA_M.filter((v) => (cfg.params.M.values || []).includes(v));
  if (!newM.length) {
    console.error(`${tag}: none of ${EXTRA_M.join(",")} are in the config's M axis — `
      + `run node src/generate_structure_experiments.js first. Skipping.`);
    skipped++; continue;
  }
  if (!fs.existsSync(shortfall)) {
    console.error(`${tag}: no results yet — run ./src/run_structure_experiments.sh ${entry.n} first. Skipping.`);
    skipped++; continue;
  }
  if (!FORCE && mColumnHasAny(shortfall, newM)) {
    console.log(`${tag}: results already carry M ∈ {${newM.join(",")}} — skipping (--force to append anyway)`);
    skipped++; continue;
  }

  const otherKey = entry.x === "M" ? entry.y : entry.x;
  const otherLen = (cfg.params[otherKey].values || []).length;
  const runs = newM.length * otherLen * (REPLICATES || cfg.replicates || 1) * (cfg.pairWithBaseline ? 2 : 1);
  console.log(`${tag}: ${entry.x} x ${entry.y}  ·  ${newM.length} new M × ${otherLen} ${otherKey} `
    + `= ${newM.length * otherLen} cells  ·  ${runs.toLocaleString()} runs`);
  if (DRY) continue;

  const sub = { ...cfg, params: { ...cfg.params, M: { ...cfg.params.M, values: newM } } };
  if (REPLICATES) sub.replicates = REPLICATES;

  const res = runAndMerge(tag, sub, "structure-M-ext", { workers: WORKERS });
  if (!res.ok) { console.error(`${tag}: ${res.reason} — nothing merged`); failed++; continue; }
  const bad = res.results.find((r) => r.filled.length || r.dropped.length);
  if (bad) {
    console.error(`${tag}: column layout drifted (filled ${bad.filled.join(",") || "-"} / dropped ${bad.dropped.join(",") || "-"}) `
      + `— merged anyway, but check build_report output`);
  }
  console.log(`${tag}: merged  (+${res.results[2].added.toLocaleString()} shortfall rows)\n`);
  merged++;
}

if (!DRY) {
  console.log(`\ndone: ${merged} merged, ${skipped} skipped, ${failed} failed`);
  if (merged && !failed) console.log(`next: ./src/build_reports.sh   (or node src/build_structure_report.js)`);
}
process.exit(failed ? 1 : 0);
