// Checks how much the self-renewal/collapse story (the model's headline finding —
// see the "self-renewal" test in test_engine.js) depends on the specific choice of
// EXPERT_THRESHOLD (engine.js), which is a hardcoded constant, not a configurable
// parameter. Doesn't modify engine.js — reruns the same self-renewal scenario and
// recomputes "fraction of the population >= threshold" directly from the final
// population's E array at several candidate thresholds.
//
// This is the script that originally justified moving EXPERT_THRESHOLD from an
// uncalibrated 0.7 to 0.585 — see "Expert threshold" in README.md for the full
// writeup (the amplification-regime artifact, why 0.585 specifically, etc.). Kept
// runnable so the current value can be re-checked after any change to the dynamics.
//
// Run: node src/expert_threshold_sensitivity.js

"use strict";
const { initSim, tick, DEFAULT_PARAMS } = require("./engine.js");

function shareAtThreshold(E, threshold) {
  let count = 0;
  for (let i = 0; i < E.length; i++) if (E[i] >= threshold) count++;
  return count / E.length;
}

// Same scenario as test_engine.js's "self-renewal" test (#13).
const params = { seed: 42, N: 1500, M: 75, turnoverRate: 0.01, transferRate: DEFAULT_PARAMS.transferRate };
const base = initSim(Object.assign({}, params, { aiEnabled: false }));
const treat = initSim(Object.assign({}, params, { aiEnabled: true }));
for (let k = 0; k < 1500; k++) { tick(base); tick(treat); }

let sumB = 0, sumT = 0;
for (let i = 0; i < base.N; i++) sumB += base.E[i];
for (let i = 0; i < treat.N; i++) sumT += treat.E[i];
console.log("meanE_baseline=" + (sumB / base.N).toFixed(3), "meanE_treatment=" + (sumT / treat.N).toFixed(3));
console.log("");

const thresholds = [0.1, 0.2, 0.3, 0.4, 0.5, 0.585, 0.6, 0.7, 0.8, 0.82, 0.84, 0.86, 0.88, 0.9];
console.log("threshold  shareExpert_baseline  shareExpert_treatment  gap");
for (const th of thresholds) {
  const b = shareAtThreshold(base.E, th);
  const t = shareAtThreshold(treat.E, th);
  console.log(
    th.toFixed(2).padStart(9) + "  " +
    b.toFixed(3).padStart(20) + "  " +
    t.toFixed(3).padStart(22) + "  " +
    (b - t).toFixed(3)
  );
}
