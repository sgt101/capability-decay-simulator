// Phase A of world-model-plan.md — recalibrate the learning/decay parameters for
// the declared time base (1 tick = 1 month, 40-year career = 480 ticks).
//
//   node calibrate_time_base.js            # the scan
//   node calibrate_time_base.js --verify   # detail on the recommended cell only
//
// Why this is needed: DEFAULT_PARAMS was tuned when the tick was dimensionless.
// At turnoverRate = 1/480 the old transferRate=0.5 drives 98% of the population
// above E=0.95 — the no-AI baseline saturates and the AI contrast has nothing to
// measure against. See paper.md "Time, turnover, and population scale".
//
// Three things are measured per candidate cell, because any one alone misleads:
//   1. STATIONARITY of the no-AI baseline over the reporting horizon
//   2. the population level (is there dynamic range left?)
//   3. how long an individual novice takes to reach EXPERT_THRESHOLD
//
// (1) is the binding constraint and was added after the fact. A drifting baseline
// makes meanE_shortfall uninterpretable — it becomes "what AI removed, plus
// wherever the baseline had wandered to by the reporting tick". Worse, because
// sd(E) is only ~0.06, a drift of just 0.035 in meanE dragged shareExpert from
// 0.80 to 0.05. Cells are now REJECTED for drifting, however good they look on
// the other two.
//
// (2) and (3) are coupled — transferRate sets both individual learning speed AND
// the population level people learn from — which is why this is scanned rather
// than reasoned about.
//
// SCALE MATTERS. The stationary ridge sits in a different place on the BA graph
// than on the world-model graph, so calibrating on one and applying to the other
// gives the wrong answer. Pass --world-model to scan against the real graph;
// that is what the world-model experiment set needs.
"use strict";
const fs = require("fs");
const path = require("path");
const { initSim, tick, EXPERT_THRESHOLD, DEFAULT_PARAMS } = require("./engine.js");

const USE_WM = process.argv.includes("--world-model");
let WM = null;
if (USE_WM) {
  const { loadWorldModel } = require("./world_model.js");
  WM = loadWorldModel(
    JSON.parse(fs.readFileSync(path.join(__dirname, "world-model.json"), "utf8")),
    JSON.parse(fs.readFileSync(path.join(__dirname, "mobility-costs.json"), "utf8"))
  );
}
// Extra params that put the run on whichever graph is being calibrated.
function graphParams() {
  return USE_WM
    ? { graphSource: "worldModel", worldModel: WM, institutionSizing: "weighted" }
    : { M: 100 };
}

const TICKS_PER_YEAR = 12;
const CAREER_YEARS = 40;
const TURNOVER = 1 / (CAREER_YEARS * TICKS_PER_YEAR); // 0.002083

// Calibration target. This is a DOMAIN ASSUMPTION, not a measurement — the whole
// scan hangs off it, so it is stated here rather than buried.
const TARGET_YEARS_TO_EXPERT = 8;
const TARGET_TICKS = TARGET_YEARS_TO_EXPERT * TICKS_PER_YEAR;

const BURN_IN = 3000;   // ticks to reach equilibrium before measuring
const TRACK = 400;      // ticks to follow a novice cohort
// N is deliberately below the production 10,504 so a 25-cell scan finishes in
// minutes. The equilibrium LEVEL is mildly N-dependent, so verify the winning
// cell at production N before committing it (see --verify).
const N = USE_WM ? 4000 : 3000, M = 100, SEED = 11;

// Stationarity is judged over the real reporting horizon, from one career in
// (past the initial transient) to the end.
const HORIZON = 1440;      // 3 careers — the experiment set's horizon
const DRIFT_FROM = 120;    // 1 year in
const MAX_DRIFT = 0.010;   // |meanE(1440) - meanE(120)| a cell may show

function equilibrium(params) {
  const s = initSim(Object.assign({ N, seed: SEED, turnoverRate: TURNOVER }, graphParams(), params));
  let last;
  for (let i = 0; i < BURN_IN; i++) last = tick(s);
  return { s, last };
}

// Median ticks for a novice to reach EXPERT_THRESHOLD, measured inside an
// already-equilibrated population. Turnover is frozen during tracking so the
// cohort isn't silently replaced mid-measurement; the population is already at
// steady state, so freezing it briefly does not move Ebar materially (asserted
// below via ebarDrift).
function timeToExpert(s) {
  const ebarBefore = s.history[s.history.length - 1].meanE;
  const saved = s.params.turnoverRate;
  s.params.turnoverRate = 0;

  const cohort = [];
  for (let i = 0; i < s.N; i += 15) {           // ~200 individuals, spread across institutions
    s.E[i] = DEFAULT_PARAMS.entrantExpertiseMean;
    s.C[i] = s.E[i];
    cohort.push({ i, t: null });
  }
  for (let step = 1; step <= TRACK; step++) {
    tick(s);
    for (const c of cohort) if (c.t === null && s.E[c.i] >= EXPERT_THRESHOLD) c.t = step;
  }
  s.params.turnoverRate = saved;

  const done = cohort.filter((c) => c.t !== null).map((c) => c.t).sort((a, b) => a - b);
  const ebarDrift = Math.abs(s.history[s.history.length - 1].meanE - ebarBefore);
  return {
    median: done.length >= cohort.length / 2 ? done[Math.floor(done.length / 2)] : null,
    reached: done.length / cohort.length,
    ebarDrift,
  };
}

// Baseline drift across the actual reporting horizon, measured from a FRESH run
// (not the burnt-in one) — that is where a user would see it.
function horizonDrift(params) {
  const s = initSim(Object.assign({ N, seed: SEED, turnoverRate: TURNOVER }, graphParams(), params));
  let early = null, late = null;
  for (let i = 1; i <= HORIZON; i++) {
    const e = tick(s);
    if (i === DRIFT_FROM) early = e.meanE;
    if (i === HORIZON) late = e.meanE;
  }
  return { drift: late - early, early, late };
}

function evaluate(params) {
  const { s, last } = equilibrium(params);
  const E = Array.from(s.E);
  const saturated = E.filter((e) => e >= 0.95).length / E.length;
  const tte = timeToExpert(s);
  const hd = horizonDrift(params);
  return {
    meanE: last.meanE,
    shareExpert: last.shareExpert,
    saturated,
    ttexpert: tte.median,
    reached: tte.reached,
    drift: tte.ebarDrift,
    horizonDrift: hd.drift,
    meanEStart: hd.early,
    meanEEnd: hd.late,
  };
}

// A cell is usable if the baseline has room to move in BOTH directions. The
// upper bound matters as much as the lower: a baseline at shareExpert=0.99 can
// only be pushed down, so it cannot show an AI-amplification regime at all.
function verdict(r) {
  if (r.shareExpert < 0.20) return "collapsed";
  if (r.saturated > 0.20) return "saturated";
  // Stationarity first among the soft criteria: a drifting baseline makes the
  // headline metric uninterpretable no matter how healthy the level looks.
  if (Math.abs(r.horizonDrift) > MAX_DRIFT) return "DRIFTS";
  return "USABLE";
}

// Refined around the transition found by the coarse grid. Outside roughly
// transferRate 0.11-0.15 there is nothing useful: above it the population pins
// at shareExpert ~0.99 (no range), below it collapses to 0.
const TRANSFER = [0.20, 0.17, 0.15, 0.13, 0.11];
const DECAY = [0.012, 0.016, 0.020, 0.024, 0.028];

if (process.argv.includes("--verify")) {
  const t = parseFloat(process.env.TR || "0.12");
  const d = parseFloat(process.env.DR || "0.02");
  console.log(`verify transferRate=${t} decayRate=${d} turnoverRate=${TURNOVER.toFixed(6)}\n`);
  console.log(`  graph: ${USE_WM ? "world model" : "BA M=" + M}\n`);
  const r = evaluate({ transferRate: t, decayRate: d });
  console.log("  meanE               ", r.meanE.toFixed(4));
  console.log("  shareExpert         ", r.shareExpert.toFixed(4));
  console.log("  fraction E>=0.95    ", r.saturated.toFixed(4));
  console.log("  median ticks->expert", r.ttexpert, r.ttexpert ? `(${(r.ttexpert / 12).toFixed(1)} years)` : "(never)");
  console.log("  cohort reaching     ", (r.reached * 100).toFixed(0) + "%");
  console.log("  Ebar drift w/ turnover frozen", r.drift.toFixed(4), r.drift < 0.02 ? "(ok)" : "(TOO HIGH - method suspect)");
  console.log("  baseline drift over horizon", (r.horizonDrift >= 0 ? "+" : "") + r.horizonDrift.toFixed(4),
    Math.abs(r.horizonDrift) <= MAX_DRIFT ? "(stationary)" : "(DRIFTS)");
  console.log("  verdict             ", verdict(r));
  process.exit(0);
}

console.log(`Phase A calibration scan`);
console.log(`  tick = 1 month, career = ${CAREER_YEARS}y, turnoverRate = ${TURNOVER.toFixed(6)}`);
console.log(`  target time-to-expert = ${TARGET_YEARS_TO_EXPERT}y (${TARGET_TICKS} ticks)  [DOMAIN ASSUMPTION]`);
console.log(`  graph: ${USE_WM ? "WORLD MODEL (M=" + WM.M + ", intake-weighted)" : "BA (M=" + M + ")"}`);
console.log(`  N=${N} burn-in=${BURN_IN} EXPERT_THRESHOLD=${EXPERT_THRESHOLD}\n`);
console.log(`  stationarity: |meanE(t=${HORIZON}) - meanE(t=${DRIFT_FROM})| must be <= ${MAX_DRIFT}`);
console.log(`  cells show: meanE / baselineDrift / verdict`);
console.log(`  ${"transfer\\decay".padEnd(15)}` + DECAY.map((d) => String(d).padStart(20)).join(""));

const results = [];
for (const tr of TRANSFER) {
  let row = "  " + String(tr).padEnd(15);
  for (const dr of DECAY) {
    const r = evaluate({ transferRate: tr, decayRate: dr });
    const v = verdict(r);
    results.push({ tr, dr, ...r, verdict: v });
    const flag = v === "USABLE" ? "ok" : v === "DRIFTS" ? "drift" : v.slice(0, 5);
    row += `${r.meanEEnd.toFixed(3)}/${(r.horizonDrift >= 0 ? "+" : "") + r.horizonDrift.toFixed(3)}/${flag}`.padStart(20);
  }
  console.log(row);
}

// Among stationary cells, prefer the flattest baseline — that is the property
// the headline metric depends on. Time-to-expert breaks ties.
const usable = results.filter((r) => r.verdict === "USABLE");
usable.sort((a, b) => Math.abs(a.horizonDrift) - Math.abs(b.horizonDrift));

console.log(`\nusable cells: ${usable.length} of ${results.length}`);
if (usable.length) {
  console.log(`\nranked by baseline flatness (the binding requirement):`);
  usable.slice(0, 6).forEach((r, k) => {
    console.log(`  ${k + 1}. transferRate=${r.tr} decayRate=${r.dr}` +
      `  -> drift ${(r.horizonDrift >= 0 ? "+" : "") + r.horizonDrift.toFixed(4)}, meanE ${r.meanEEnd.toFixed(3)}` +
      `, shareExpert ${r.shareExpert.toFixed(3)}` +
      (r.ttexpert ? `, ${(r.ttexpert / 12).toFixed(1)}y to expert` : ""));
  });
  const best = usable[0];
  console.log(`\nrecommended: transferRate=${best.tr}, decayRate=${best.dr}, turnoverRate=${TURNOVER.toFixed(6)}`);
} else {
  console.log("\nNO USABLE CELL — widen the grid or revisit personalLearningRate.");
}
