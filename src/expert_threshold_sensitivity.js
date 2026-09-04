// Checks how much the self-renewal/collapse story (the model's headline finding —
// see the "self-renewal" test in test_engine.js) depends on the specific choice of
// EXPERT_THRESHOLD (engine.js), which is a hardcoded constant, not a configurable
// parameter. Doesn't modify engine.js — reruns the scenario and recomputes
// "fraction of the population >= threshold" directly from the final population's E
// array at several candidate thresholds.
//
// Run: node src/expert_threshold_sensitivity.js
//
// TWO REGIMES, and the second is the one that matters.
//
//   legacy      DEFAULT_PARAMS, N=1500, M=75, BA graph, 1500 dimensionless ticks.
//               This is the scenario that originally justified moving
//               EXPERT_THRESHOLD from an uncalibrated 0.7 to 0.585: the contrast
//               reads cleanly across roughly [0.30, 0.86], and 0.585 is the
//               midpoint of that band. Kept because it is the provenance of the
//               shipped constant, NOT because it describes what the model now runs.
//
//   worldmodel  MONTHLY_TICK_PARAMS + PIPELINE_PARAMS + WORLD_MODEL_PARAMS on the
//               world-model graph, horizon 1440 — the calibration every reported
//               experiment uses. Added 2026-08 after noticing the constant had been
//               chosen under the legacy regime and never rechecked. It matters
//               because the two regimes sit in completely different places relative
//               to the threshold: legacy baseline meanE is ~0.845, comfortably above
//               0.585, while the world-model baseline equilibrates at ~0.566, just
//               BELOW it. A threshold picked to make shareExpert insensitive can end
//               up sitting exactly where the population mass is, which is where it is
//               most sensitive instead. See doc/world-model-plan.md on shareExpert
//               "behaving like a step".
//
// The treatment arm is the strong-de-skilling end of the reported sweep
// (aiDampeningBelow = 0) rather than the engine default, so the two regimes are
// compared on the same thing: maximum AI-induced collapse against no AI at all.
"use strict";
const fs = require("fs");
const { initSim, tick, DEFAULT_PARAMS, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS,
        WORLD_MODEL_PARAMS, EXPERT_THRESHOLD, TICKS_PER_YEAR } = require("./engine.js");
const { loadWorldModel } = require("./world_model.js");
const paths = require("./paths.js");

const THRESHOLDS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.55, 0.585, 0.6, 0.65, 0.7, 0.75,
                    0.8, 0.82, 0.84, 0.86, 0.88, 0.9];
// A threshold is USABLE when the two arms are far apart: the baseline still has a
// substantial expert population and the treatment arm has lost it. Both halves are
// needed — a gap can also close because the baseline collapsed, which says nothing
// about AI.
const USABLE_GAP = 0.5;

const shareAt = (E, th) => { let c = 0; for (let i = 0; i < E.length; i++) if (E[i] >= th) c++; return c / E.length; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

function run(params, ticks) {
  const s = initSim(params);
  for (let k = 0; k < ticks; k++) tick(s);
  return s.E;
}

// Averages shares over seeds rather than pooling the populations, so each seed
// weighs equally regardless of N.
function arm(mk, ticks, seeds) {
  const per = seeds.map((seed) => {
    const E = run(mk(seed), ticks);
    return { meanE: mean([...E]), shares: THRESHOLDS.map((th) => shareAt(E, th)) };
  });
  return {
    meanE: mean(per.map((p) => p.meanE)),
    shares: THRESHOLDS.map((_, i) => mean(per.map((p) => p.shares[i]))),
  };
}

function report(label, base, treat) {
  console.log(`\n=== ${label} ===`);
  console.log(`baseline meanE = ${base.meanE.toFixed(3)}   treatment meanE = ${treat.meanE.toFixed(3)}`);
  console.log("\nthreshold  shareExpert_baseline  shareExpert_treatment      gap");
  const usable = [];
  THRESHOLDS.forEach((th, i) => {
    const b = base.shares[i], t = treat.shares[i], g = b - t;
    if (g >= USABLE_GAP) usable.push(th);
    console.log(th.toFixed(3).padStart(9) + "  " + b.toFixed(3).padStart(20) + "  "
      + t.toFixed(3).padStart(21) + "  " + g.toFixed(3).padStart(7)
      + (g >= USABLE_GAP ? "  <-" : ""));
  });
  if (!usable.length) {
    console.log(`\n  NO threshold reaches a gap of ${USABLE_GAP}. The contrast this constant`);
    console.log("  is chosen to express does not exist in this regime.");
    return;
  }
  const lo = usable[0], hi = usable[usable.length - 1], mid = (lo + hi) / 2;
  console.log(`\n  usable band (gap >= ${USABLE_GAP}): ${lo} to ${hi}`);
  console.log(`  midpoint: ${mid.toFixed(3)}     shipped EXPERT_THRESHOLD: ${EXPERT_THRESHOLD}`);
  // Where the population actually sits matters as much as the band. A threshold in
  // the middle of the baseline distribution makes shareExpert a knife-edge however
  // wide the band is.
  console.log(`  baseline meanE - threshold: ${(base.meanE - EXPERT_THRESHOLD >= 0 ? "+" : "")}`
    + `${(base.meanE - EXPERT_THRESHOLD).toFixed(3)}`
    + (Math.abs(base.meanE - EXPERT_THRESHOLD) < 0.05
      ? "   <- population mean sits ON the threshold: shareExpert is a step here"
      : ""));
}

const SEEDS = [42, 43, 44];

// --- legacy regime, kept as the provenance of the shipped constant ------------------
{
  const p = { N: 1500, M: 75, turnoverRate: 0.01, transferRate: DEFAULT_PARAMS.transferRate };
  report("legacy (DEFAULT_PARAMS, BA graph, 1500 ticks) — how 0.585 was originally chosen",
    arm((seed) => ({ ...p, seed, aiEnabled: false }), 1500, SEEDS),
    arm((seed) => ({ ...p, seed, aiEnabled: true }), 1500, SEEDS));
}

// --- world-model regime, which is what the reported experiments run -----------------
{
  const wm = loadWorldModel(
    JSON.parse(fs.readFileSync(paths.data("world-model.json"), "utf8")),
    JSON.parse(fs.readFileSync(paths.data("mobility-costs.json"), "utf8")),
    { useBlocAffinity: true, hubSource: "located_in", prestigeFrom: "intake",
      zeroIntakePolicy: "floor1", useExplicitEdges: true });
  // Mirrors BASE_FIXED in generate_worldmodel_experiments.js. M is NOT set — it is
  // derived from the world model, and setting it throws.
  const base = Object.assign({
    graphSource: "worldModel", institutionSizing: "weighted", worldModel: wm,
    expertiseMean: 0.28, expertiseSpread: 0.30, expertiseSkew: 3,
    entrantExpertiseMean: 0.05, entrantExpertiseSpread: 0.05, entrantExpertiseFloor: 0.05,
    mobilityMode: "hybrid", jumpProbability: 0.10,
    competitionAversion: 0.5, prestigeWeight: 0.3,
    aiLevelFraction: EXPERT_THRESHOLD, aiDampeningAbove: 1.0,
  }, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS, WORLD_MODEL_PARAMS);
  const HORIZON = 120 * TICKS_PER_YEAR;   // 1440 ticks, 3 careers — the reported horizon
  report("world model (the reported calibration, horizon 1440) — treatment is aiDampeningBelow = 0",
    arm((seed) => ({ ...base, seed, aiEnabled: false }), HORIZON, SEEDS),
    arm((seed) => ({ ...base, seed, aiEnabled: true, aiDampeningBelow: 0 }), HORIZON, SEEDS));
}
