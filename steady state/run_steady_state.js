// Empirically checks whether the no-AI baseline has a genuine steady state — a
// population-level equilibrium the model settles into and stays at, independent of
// where it started, rather than something that just hasn't diverged yet within the
// model's normal 1000-tick reporting horizon.
//
// Three checks, each writing its own CSV into this directory:
//   1. convergence_from_different_starts.csv — does the no-AI baseline converge to
//      the same band from very different starting populations?
//   2. seed_variance_at_steady_state.csv — across many seeds, at a tick well past
//      normal horizon, how tight is the spread around that band? Run both with the
//      current ambientGrowthRate default and with it at 0, to separate "is there an
//      equilibrium at all" from "did ambientGrowthRate specifically create it."
//   3. long_horizon_trace.csv — averaged across several seeds, does the aggregate
//      keep climbing indefinitely (as it would if ambient growth's positive feedback
//      loop weren't bounded) or genuinely hold flat out to 50,000 ticks?
//
// Run: node "steady state/run_steady_state.js"   (from the project root, or anywhere
// — path to engine.js is resolved relative to this file, not the cwd)

"use strict";
const fs = require("fs");
const path = require("path");
const { initSim, tick } = require(path.join(__dirname, "..", "engine.js"));

function writeCSV(file, header, rows) {
  const out = [header.join(",")].concat(rows.map((r) => r.join(","))).join("\n") + "\n";
  fs.writeFileSync(path.join(__dirname, file), out);
  console.log(`wrote ${file} (${rows.length} rows)`);
}

function runTo(overrides, ticks, marks) {
  const s = initSim(Object.assign({ aiEnabled: false }, overrides));
  const out = [];
  for (let k = 1; k <= ticks; k++) {
    tick(s);
    if (marks.includes(k)) {
      const h = s.history[s.history.length - 1];
      out.push({ t: k, meanE: h.meanE, shareExpert: h.shareExpert, divergence: h.divergence });
    }
  }
  return out;
}

/* ---------- 1. Convergence from different starting populations ---------- */
{
  const marks = [100, 500, 1000, 2000, 4000, 8000, 12000, 16000, 20000];
  const starts = [0.05, 0.28, 0.50, 0.70];
  const rows = [];
  for (const expertiseMean of starts) {
    const trace = runTo({ seed: 1, expertiseMean }, 20000, marks);
    for (const pt of trace) rows.push([expertiseMean, pt.t, pt.meanE.toFixed(6), pt.shareExpert.toFixed(6), pt.divergence.toFixed(6)]);
  }
  writeCSV("convergence_from_different_starts.csv", ["startExpertiseMean", "t", "meanE", "shareExpert", "divergence"], rows);
}

/* ---------- 2. Seed variance at a tick well past normal horizon ---------- */
{
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const rows = [];
  for (const seed of seeds) {
    const withAmbient = runTo({ seed }, 10000, [10000])[0];
    const noAmbient = runTo({ seed, ambientGrowthRate: 0 }, 10000, [10000])[0];
    rows.push([seed, withAmbient.meanE.toFixed(6), withAmbient.shareExpert.toFixed(6), noAmbient.meanE.toFixed(6), noAmbient.shareExpert.toFixed(6)]);
  }
  writeCSV(
    "seed_variance_at_steady_state.csv",
    ["seed", "meanE_ambientDefault_t10000", "shareExpert_ambientDefault_t10000", "meanE_ambientZero_t10000", "shareExpert_ambientZero_t10000"],
    rows
  );
}

/* ---------- 3. Long-horizon trace, averaged across seeds ---------- */
{
  const marks = [1000, 5000, 10000, 25000, 50000];
  const seeds = [1, 2, 3];
  const perSeed = seeds.map((seed) => runTo({ seed }, 50000, marks)); // one continuous run per seed, not one restart per mark
  const rows = marks.map((t, mi) => {
    const sumE = perSeed.reduce((s, trace) => s + trace[mi].meanE, 0);
    const sumShare = perSeed.reduce((s, trace) => s + trace[mi].shareExpert, 0);
    return [t, (sumE / seeds.length).toFixed(6), (sumShare / seeds.length).toFixed(6)];
  });
  writeCSV("long_horizon_trace.csv", ["t", "meanE_avgAcross3Seeds", "shareExpert_avgAcross3Seeds"], rows);
}

console.log("done.");
