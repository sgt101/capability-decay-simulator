#!/usr/bin/env node
// Runs the REAL institution graph as one extra row on the structure experiments that
// cross an AI parameter with M — structure.1 (aiLevelFraction), structure.3
// (aiDampeningBelow), structure.5 (aiDampeningAbove) — so a reader can see whether any
// synthetic M lands near the world model's behaviour. The row sits at M = 330, the world
// model's own institution count.
//
//   node src/run_structure_worldmodel_row.js --workers 14
//   node src/run_structure_worldmodel_row.js --only 3
//   node src/run_structure_worldmodel_row.js --dry-run
//   node src/run_structure_worldmodel_row.js --force
//   node src/run_structure_worldmodel_row.js --replicates 2   # cheap pipeline check only
//
// TOPOLOGY SWAP. It reads data/experiments-structure/worldmodel/structure.N.json —
// written by generate_structure_experiments.js — which is structure.N's own calibration
// with graphSource "worldModel" and institutionSizing "weighted", and nothing else
// changed. So the row is directly comparable to the BA M rows beside it; the only
// differences are the graph and that real institutions have real sizes.
//
// The world-model run's CSV carries a worldModelFingerprint column where a BA run has an
// empty `worldModel` column; structure_merge.remapAppend reconciles that by name. As
// with the M extension, seeds and comboIndex are not those a full re-run would assign —
// the 32-replicate mean is unbiased, and build_report keys on the axis values.
"use strict";
const fs = require("fs");
const path = require("path");
const paths = require("./paths.js");
const { mColumnHasAny, runAndMerge } = require("./structure_merge.js");

const M_WORLDMODEL = 330;                    // data/world-model.json institution count
const EXPERIMENTS = [1, 3, 5];               // aiLevelFraction / aiDampeningBelow / aiDampeningAbove × M
const WM_DIR = path.join(paths.DATA, "experiments-structure", "worldmodel");
// remapAppend fills this target column blank and drops that source column — expected
// for every worldModel→BA merge; anything else means the schema moved.
const EXPECT_FILLED = ["worldModel"];
const EXPECT_DROPPED = ["worldModelFingerprint"];

const argVal = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const has = (f) => process.argv.includes(f);
const DRY = has("--dry-run"), FORCE = has("--force");
const WORKERS = argVal("--workers");
const REPLICATES = argVal("--replicates") ? Number(argVal("--replicates")) : null;
const ONLY = argVal("--only") ? new Set(argVal("--only").split(",").map((s) => Number(s.trim()))) : null;

const nums = EXPERIMENTS.filter((n) => !ONLY || ONLY.has(n));
if (!nums.length) { console.error("--only matched none of experiments 1, 3, 5"); process.exit(1); }

console.log(`structure world-model row: M = ${M_WORLDMODEL} (the real institution graph)`);
console.log(`${nums.length} experiment(s): ${nums.join(", ")}${DRY ? "   (dry run)" : ""}\n`);

let merged = 0, skipped = 0, failed = 0;

for (const n of nums) {
  const tag = `structure.${n}`;
  const cfgPath = path.join(WM_DIR, `structure.${n}.json`);
  const shortfall = path.join(paths.RESULTS, tag, "results_shortfall.csv");

  if (!fs.existsSync(cfgPath)) {
    console.error(`${tag}: ${path.relative(paths.ROOT, cfgPath)} not found — `
      + `run node src/generate_structure_experiments.js first. Skipping.`);
    skipped++; continue;
  }
  if (!fs.existsSync(shortfall)) {
    console.error(`${tag}: no BA results yet — run ./src/run_structure_experiments.sh ${n} first. Skipping.`);
    skipped++; continue;
  }
  if (!FORCE && mColumnHasAny(shortfall, [M_WORLDMODEL])) {
    console.log(`${tag}: results already carry an M=${M_WORLDMODEL} row — skipping (--force to append anyway)`);
    skipped++; continue;
  }

  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const axisKey = Object.keys(cfg.params)[0];
  const axisLen = (cfg.params[axisKey].values || []).length;
  const runs = axisLen * (REPLICATES || cfg.replicates || 1) * (cfg.pairWithBaseline ? 2 : 1);
  console.log(`${tag}: ${axisKey} × M=${M_WORLDMODEL}  ·  ${axisLen} cells  ·  ${runs.toLocaleString()} runs`);
  if (DRY) continue;

  const sub = REPLICATES ? { ...cfg, replicates: REPLICATES } : cfg;
  const res = runAndMerge(tag, sub, "structure-wmrow", { workers: WORKERS });
  if (!res.ok) { console.error(`${tag}: ${res.reason} — nothing merged`); failed++; continue; }

  const drift = res.results.find((r) =>
    r.filled.join() !== EXPECT_FILLED.join() || r.dropped.join() !== EXPECT_DROPPED.join());
  if (drift) {
    console.error(`${tag}: unexpected column reconciliation — filled [${drift.filled}], dropped [${drift.dropped}] `
      + `(expected filled [${EXPECT_FILLED}], dropped [${EXPECT_DROPPED}]). Merged anyway; check build_report output.`);
  }
  console.log(`${tag}: merged  (+${res.results[2].added.toLocaleString()} shortfall rows at M=${M_WORLDMODEL})\n`);
  merged++;
}

if (!DRY) {
  console.log(`\ndone: ${merged} merged, ${skipped} skipped, ${failed} failed`);
  if (merged && !failed) console.log(`next: ./src/build_reports.sh   (or node src/build_structure_report.js)`);
}
process.exit(failed ? 1 : 0);
