// Tests for world_model.js (Phase C) and the engine's world-model mode (Phase D).
//   node src/test/test_world_model.js
"use strict";
const fs = require("fs");
const path = require("path");
const { loadWorldModel, suggestedN, fnv1a } = require("../world_model.js");
const { initSim, tick, generateBAGraph, mulberry32, MONTHLY_TICK_PARAMS } = require("../engine.js");
const paths = require("../paths.js");

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { console.log("ok: " + msg); pass++; }
  else { console.error("FAIL: " + msg); fail++; }
}

const WORLD = JSON.parse(fs.readFileSync(paths.data("world-model.json"), "utf8"));
const COSTS = JSON.parse(fs.readFileSync(paths.data("mobility-costs.json"), "utf8"));
const wm = loadWorldModel(WORLD, COSTS);
const byLabel = (l) => wm.institutions.findIndex((i) => i.label === l);

// --- 1. shape parity with generateBAGraph --------------------------------
console.log("\n--- shape parity ---");
const ba = generateBAGraph(40, 2, mulberry32(1));
["M", "neighbors", "degree", "prestige"].forEach((k) => {
  assert(wm[k] !== undefined, `world model supplies '${k}' just like generateBAGraph`);
});
assert(wm.neighbors.length === wm.M && wm.degree.length === wm.M && wm.prestige.length === wm.M,
  "neighbors/degree/prestige are all length M");
assert(wm.neighbors[0] instanceof Set && ba.neighbors[0] instanceof Set,
  "neighbors entries are Sets in both, so candidateInstitutions can iterate either");
let prestigeOk = true;
for (let i = 0; i < wm.M; i++) if (!(wm.prestige[i] >= 0 && wm.prestige[i] <= 1)) prestigeOk = false;
assert(prestigeOk, "prestige is normalised to [0,1]");

// --- 2. determinism -------------------------------------------------------
console.log("\n--- determinism ---");
const wm2 = loadWorldModel(WORLD, COSTS);
assert(wm2.fingerprint === wm.fingerprint, "same inputs produce the same fingerprint");
assert(wm2.M === wm.M, "same inputs produce the same M");
let sameAff = true;
for (let k = 0; k < 200; k++) {
  const i = k % wm.M, j = (k * 7 + 3) % wm.M;
  if (wm.affinity(i, j) !== wm2.affinity(i, j)) sameAff = false;
}
assert(sameAff, "affinity is deterministic across loads");
const wmOpt = loadWorldModel(WORLD, COSTS, { useBlocAffinity: false });
assert(wmOpt.fingerprint !== wm.fingerprint, "changing an option changes the fingerprint (provenance is option-sensitive)");
assert(fnv1a("a") !== fnv1a("b"), "fingerprint hash distinguishes different inputs");

// --- 3. affinity tiers match the spec table ------------------------------
console.log("\n--- affinity tiers (world-model-plan.md section 3) ---");
const gs = byLabel("Goldman Sachs"), ms = byLabel("Morgan Stanley");
assert(gs >= 0 && ms >= 0, "found Goldman Sachs and Morgan Stanley");
assert(wm.affinity(gs, ms) === 1.0, "same city + same subsector = 1.0 (frictionless)");
assert(wm.affinity(gs, gs) === 1.0, "self-affinity is 1.0");
let inRange = true;
for (let k = 0; k < 3000; k++) {
  const i = k % wm.M, j = (k * 13 + 5) % wm.M;
  const a = wm.affinity(i, j);
  if (!(a > 0 && a <= 1)) inRange = false;
}
assert(inRange, "affinity is always in (0,1] — never zero (rare, but never impossible) and never >1");

// --- 4. ASYMMETRY (decision 5) -------------------------------------------
console.log("\n--- asymmetry: people don't move against the flow ---");
const hdfc = byLabel("HDFC Bank");
assert(hdfc >= 0, "found an Indian institution (HDFC Bank)");
const up = wm.affinity(hdfc, gs), down = wm.affinity(gs, hdfc);
assert(up > down, `moving UP the gradient is easier: India->US ${up.toFixed(4)} > US->India ${down.toFixed(4)}`);
const costsNoGrad = JSON.parse(JSON.stringify(COSTS));
costsNoGrad.gradient.gamma = 0;
const wmSym = loadWorldModel(WORLD, costsNoGrad);
assert(Math.abs(wmSym.affinity(hdfc, gs) - wmSym.affinity(gs, hdfc)) < 1e-12,
  "gamma = 0 makes affinity symmetric again (the asymmetry switch works)");
// The gradient only ever PENALISES, so gamma changes the downhill direction and
// leaves the uphill one alone — comparing uphill would compare 1.0 against 1.0.
assert(wm.affinity(hdfc, gs) === wmSym.affinity(hdfc, gs),
  "gamma leaves the UPHILL direction untouched (moving toward money is never penalised)");
assert(wm.affinity(gs, hdfc) < wmSym.affinity(gs, hdfc),
  "gamma > 0 penalises the DOWNHILL direction specifically");

// --- 5. bloc toggle -------------------------------------------------------
console.log("\n--- bloc ablation ---");
const wmNoBloc = loadWorldModel(WORLD, COSTS, { useBlocAffinity: false });
assert(wmNoBloc.M === wm.M, "disabling blocs does not change the institution set");
// same-city pairs must be untouched by the bloc switch
assert(wmNoBloc.affinity(gs, ms) === wm.affinity(gs, ms), "bloc toggle leaves same-city affinity unchanged");
// find a genuine cross-bloc pair and confirm the toggle moves it
let crossChanged = false;
for (let i = 0; i < wm.M && !crossChanged; i++) {
  for (let j = 0; j < wm.M; j++) {
    const A = wm.institutions[i], B = wm.institutions[j];
    if (!A.blocs.length || !B.blocs.length) continue;
    if (A.blocs[0] === B.blocs[0]) continue;
    if (A.countryIds.some((c) => B.countryIds.includes(c))) continue;
    if (wm.affinity(i, j) !== wmNoBloc.affinity(i, j)) { crossChanged = true; break; }
  }
}
assert(crossChanged, "bloc toggle DOES change at least one cross-bloc pair (the ablation is real)");

// --- 6. multi-hub resolution ---------------------------------------------
console.log("\n--- multi-hub (decision 4) ---");
const multi = wm.institutions.filter((i) => i.hubIds.length > 1);
assert(multi.length > 0, `${multi.length} institutions occupy more than one hub`);
const jpm = byLabel("JPMorgan");
assert(jpm >= 0 && wm.institutions[jpm].hubIds.length > 1, "JPMorgan resolves to multiple hubs");
const wmScalar = loadWorldModel(WORLD, COSTS, { hubSource: "scalar" });
assert(wmScalar.institutions[jpm].hubIds.length === 1, "hubSource 'scalar' collapses it to one hub");
let scalarLoses = 0;
for (let j = 0; j < wm.M; j++) if (wm.affinity(jpm, j) > wmScalar.affinity(jpm, j)) scalarLoses++;
assert(scalarLoses > 0, `reading the scalar loses same-city reach for ${scalarLoses} pairs (why located_in is the default)`);

// --- 7. zero-intake policy -----------------------------------------------
console.log("\n--- zero-intake policy ---");
const zeroCount = WORLD.nodes.filter((n) => n.node_type === "Organisation" && !(n.intake_estimate_central > 0)).length;
assert(zeroCount > 0, `${zeroCount} organisations have zero intake in the data`);
const wmDrop = loadWorldModel(WORLD, COSTS, { zeroIntakePolicy: "drop" });
assert(wmDrop.M === wm.M - zeroCount, "'drop' removes exactly the zero-intake organisations");
let minW = Infinity;
for (let j = 0; j < wm.M; j++) minW = Math.min(minW, wm.entryWeights[j]);
assert(minW >= 1, "'floor1' (default) leaves every institution with a non-zero entry weight");

// --- 8. validation --------------------------------------------------------
console.log("\n--- validation ---");
let threw = false;
try { loadWorldModel({ nodes: [], edges: [] }, COSTS); } catch (e) { threw = true; }
assert(threw, "throws when there are no Organisation nodes");
threw = false;
try {
  const bad = JSON.parse(JSON.stringify(WORLD));
  bad.edges.push({ edge_id: "BAD", source_id: "NOPE", target_id: "ORG_GS", edge_type: "LOCATED_IN" });
  loadWorldModel(bad, COSTS);
} catch (e) { threw = true; }
assert(threw, "throws on a dangling edge endpoint");
threw = false;
try { loadWorldModel(WORLD, { }); } catch (e) { threw = true; }
assert(threw, "throws when the cost config lacks geoTiers/sectorTiers");

// --- 9. engine integration ------------------------------------------------
console.log("\n--- engine: world-model mode ---");
const N = suggestedN(wm, 40, 400);
const base = Object.assign({}, MONTHLY_TICK_PARAMS, {
  N, seed: 3, graphSource: "worldModel", worldModel: wm,
});
const s = initSim(base);
assert(s.M === wm.M, "M is derived from the world model, not configured");
threw = false;
try { initSim(Object.assign({}, base, { M: 99 })); } catch (e) { threw = true; }
assert(threw, "setting M explicitly in world-model mode throws rather than being silently ignored");
threw = false;
try { initSim(Object.assign({}, base, { worldModel: { nope: true } })); } catch (e) { threw = true; }
assert(threw, "graphSource 'worldModel' without a real loader result throws");
threw = false;
try { initSim({ N: 100, graphSource: "worldModel", worldModel: wm, institutionSizing: "weighted" }); } catch (e) { threw = true; }
assert(!threw, "weighted sizing works when the world model supplies entryWeights");

const e1 = tick(s);
assert(typeof e1.minOccupancy === "number" && typeof e1.emptyInstitutions === "number",
  "tick reports occupancy diagnostics (minOccupancy / emptyInstitutions)");

// --- 10. D2 REGRESSION: weighted placement must survive turnover ----------
// The one most likely to silently rot: placing entrants uniformly erases any
// intake-weighted distribution within ~50 ticks.
console.log("\n--- D2 regression: weighted placement survives turnover ---");
// prestigeWeight is forced to 0 here. Otherwise the test cannot isolate what it
// claims to: the default prestigeFrom is "intake", so mobility pulls people
// toward high-intake institutions through the prestige term REGARDLESS of where
// they entered. Measured — with prestige left on, uniform placement still shows
// r=0.82 against intake, because occupancy tracks intake through two independent
// channels. Zeroing prestige leaves placement as the only one.
function occupancyCorrelation(sizing, ticks) {
  const st = initSim(Object.assign({}, MONTHLY_TICK_PARAMS, {
    N: suggestedN(wm, 40, 400), seed: 9, prestigeWeight: 0,
    graphSource: "worldModel", worldModel: wm, institutionSizing: sizing,
  }));
  for (let i = 0; i < ticks; i++) tick(st);
  const occ = new Array(st.M).fill(0);
  for (let i = 0; i < st.N; i++) occ[st.inst[i]]++;
  // Pearson correlation between intake weight and realised occupancy
  const w = Array.from(wm.entryWeights);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const mw = mean(w), mo = mean(occ);
  let num = 0, dw = 0, dobs = 0;
  for (let j = 0; j < st.M; j++) { num += (w[j] - mw) * (occ[j] - mo); dw += (w[j] - mw) ** 2; dobs += (occ[j] - mo) ** 2; }
  return num / Math.sqrt(dw * dobs);
}
const rWeighted = occupancyCorrelation("weighted", 1000);
const rUniform = occupancyCorrelation("uniform", 1000);
console.log(`   intake-vs-occupancy correlation after 1000 ticks: weighted=${rWeighted.toFixed(3)} uniform=${rUniform.toFixed(3)}`);
// Not expected to approach 1.0: entrants are placed by intake, but mobility then
// redistributes them continuously (~5% move per tick), so steady-state occupancy
// is a balance between placement and the mobility equilibrium, not a copy of the
// intake vector. What matters is that placement remains a strong signal — before
// the D2 fix it decayed to the uniform baseline within ~50 ticks.
assert(rWeighted > 0.35, `weighted placement still tracks intake after 1000 ticks (r=${rWeighted.toFixed(3)})`);
assert(rWeighted > rUniform + 0.25, "weighted is clearly distinguishable from uniform after 1000 ticks");

// --- 10b. the precomputed sampler ----------------------------------------
console.log("\n--- precomputed affinity sampler ---");
assert(typeof wm.sampleDestination === "function", "loader exposes sampleDestination");
assert(wm.affinityCDF && wm.affinityCDF.length === wm.M * wm.M, "affinityCDF is M*M");

// affinityAt must be an exact memo of affinity(), not an approximation — the
// friction term reads it every candidate evaluation.
let maxErr = 0;
for (let k = 0; k < 20000; k++) {
  const i = k % wm.M, j = (k * 17 + 3) % wm.M;
  maxErr = Math.max(maxErr, Math.abs(wm.affinityAt(i, j) - wm.affinity(i, j)));
}
assert(maxErr < 1e-12, `affinityAt matches affinity exactly (max err ${maxErr.toExponential(1)})`);

// The sampler must reproduce the affinity distribution, not merely favour it.
// Without this, a subtle off-by-one in the binary search would silently bias
// every world-model run and still look plausible.
const { mulberry32: mb } = require("../engine.js");
let worstDev = 0;
[0, 77, 200].forEach((src) => {
  const rng = mb(1234 + src), DRAWS = 120000;
  const counts = new Float64Array(wm.M);
  for (let k = 0; k < DRAWS; k++) { const d = wm.sampleDestination(src, rng()); if (d >= 0) counts[d]++; }
  let tot = 0;
  for (let j = 0; j < wm.M; j++) if (j !== src) tot += wm.affinity(src, j);
  for (let j = 0; j < wm.M; j++) {
    if (j === src) continue;
    worstDev = Math.max(worstDev, Math.abs(wm.affinity(src, j) / tot - counts[j] / DRAWS));
  }
});
assert(worstDev < 5e-3, `sampled distribution matches affinity weights (max dev ${worstDev.toExponential(1)}, sampling noise only)`);

let outOfRange = false;
for (let k = 0; k < 5000; k++) { const d = wm.sampleDestination(k % wm.M, (k * 0.000199) % 1); if (d >= wm.M) outOfRange = true; }
assert(!outOfRange, "sampleDestination never returns an index >= M");

// --- 10c. top-K candidate heuristic --------------------------------------
console.log("\n--- top-K candidate heuristic (candidateCap) ---");
assert(wm.topDestinations && wm.topDestinations.length === wm.M * wm.TOP_K, "loader precomputes topDestinations");
// top-K must actually be sorted by affinity descending, or "top" means nothing
let sortedOk = true;
for (const src of [0, 90, 210]) {
  for (let r = 1; r < wm.topCount[src]; r++) {
    const a = wm.affinityAt(src, wm.topDestinations[src * wm.TOP_K + r - 1]);
    const b = wm.affinityAt(src, wm.topDestinations[src * wm.TOP_K + r]);
    if (b > a + 1e-12) sortedOk = false;
  }
}
assert(sortedOk, "topDestinations are ordered by descending affinity");

function wmRun(extra, ticks) {
  const st = initSim(Object.assign({}, MONTHLY_TICK_PARAMS, {
    N: 2000, seed: 31, graphSource: "worldModel", worldModel: wm, institutionSizing: "weighted",
  }, extra));
  let last; for (let i = 0; i < (ticks || 200); i++) last = tick(st);
  return last;
}
const capOff = wmRun({});
assert(wmRun({ candidateCap: 0 }).meanE === capOff.meanE, "candidateCap: 0 is identical to omitting it (default is off)");
assert(wmRun({ candidateCap: 4 }).meanE !== capOff.meanE, "candidateCap > 0 actually changes the candidate set");

// --- 11. decision 6: BA behaviour is untouched ---------------------------
console.log("\n--- decision 6: the BA model is not disturbed ---");
function baRun(extra) {
  const st = initSim(Object.assign({ N: 400, M: 30, seed: 21 }, extra));
  for (let i = 0; i < 120; i++) tick(st);
  return st.history.map((h) => h.meanE.toFixed(10)).join(",");
}
const baPlain = baRun({});
assert(baRun({ institutionSizing: "uniform" }) === baPlain, "explicit uniform sizing matches the default");

// --- 12. the AI dials are independent (rho removed 2026-08) --------------
// rho used to derive aiDampeningBelow and aiAtrophyMultiplier from one cause. Both
// are gone now — rho in 2026-08, and aiAtrophyMultiplier with it once measurement
// showed it moved the shortfall by 0.005 on its own and collapsed onto decayRate at
// rank-R2 0.946 (problems.md). What still has to hold is the behaviour rho=0 stood
// in for: a neutral AI arm must be bit-identical to the no-AI arm.
console.log("\n--- AI dials set directly, no coupling ---");

const { DEFAULT_PARAMS: DPARAMS } = require("../engine.js");
assert(!("aiRelianceIntensity" in DPARAMS), "aiRelianceIntensity is gone from DEFAULT_PARAMS");

// E is all there is now — the observed-capability channel was removed with aiGain.
function eTrace(extra) {
  const st = initSim(Object.assign({ N: 300, M: 20, seed: 9 }, extra));
  for (let i = 0; i < 150; i++) tick(st);
  return st.history.map((h) => h.meanE.toFixed(10)).join(",");
}

assert(eTrace({ aiEnabled: true, aiDampeningBelow: 1, aiDampeningAbove: 1 }) === eTrace({ aiEnabled: false }),
  "both dampening dials neutral leaves expertise identical to the no-AI baseline (what rho=0 used to assert)");

// The learning channel is now the ONLY channel: with aiAtrophyMultiplier gone, AI
// acts solely by crowding out the learning people would otherwise have had.
const learningOnly = eTrace({ aiEnabled: true, aiDampeningBelow: 0.2, aiDampeningAbove: 1 });
assert(learningOnly !== eTrace({ aiEnabled: false }), "dampening learning changes the run");
assert(eTrace({ aiEnabled: true, aiDampeningBelow: 0, aiDampeningAbove: 1 }).length > 0,
  "fully blocked learning is expressible");

function throws(fn, why) { try { fn(); return false; } catch (e) { return true; } }
// Removed parameters must be REJECTED, not ignored: initSim merges unknown keys into
// params and thence into every CSV column, so a stale config would otherwise run on
// defaults while its results row still named the parameter.
for (const removed of ["aiAtrophyMultiplier", "mobilityFriction", "entrantExpertiseSkew", "aiGain", "aiResponseMode"]) {
  assert(!(removed in require("../engine.js").DEFAULT_PARAMS), `${removed} is gone from DEFAULT_PARAMS`);
  assert(throws(() => initSim({ N: 40, M: 6, [removed]: 1 })), `a config still setting ${removed} is rejected`);
}
assert(throws(() => initSim({ aiRelianceIntensity: 0.5 })),
  "a config still setting rho is REJECTED — silently ignoring it would land the key in every CSV row while the run used defaults");
assert(throws(() => initSim({ aiRelianceIntensity: 0 })),
  "even rho=0 is rejected: no value of a removed parameter is meaningful");

// --- 13. entrant floor + the lambda default (problems.md P16, P19) --------
console.log("\n--- entrant floor and the AI level default ---");
const { EXPERT_THRESHOLD: ET, DEFAULT_PARAMS: DP } = require("../engine.js");

assert(DP.aiLevelFraction === ET,
  "aiLevelFraction defaults to EXPERT_THRESHOLD, not an arbitrary number — it sits below the saturation plateau");
assert(DP.entrantExpertiseFloor === 0.05, "entrantExpertiseFloor defaults to 0.05");

// No entrant may arrive below the floor, however low the mean is set.
function minEntrantAfterTurnover(floor, mean) {
  const st = initSim({ N: 2000, M: 20, seed: 5, turnoverRate: 0.5,
    entrantExpertiseMean: mean, entrantExpertiseFloor: floor,
    transferRate: 0, decayRate: 0, personalLearningRate: 0 });   // freeze learning so only the draw shows
  tick(st);
  let min = Infinity;
  for (let i = 0; i < st.N; i++) if (st.E[i] < min) min = st.E[i];
  return min;
}
assert(minEntrantAfterTurnover(0.05, 0.0) >= 0.05 - 1e-9,
  "with the floor on, no entrant arrives below it even at entrantExpertiseMean = 0");
assert(minEntrantAfterTurnover(0, 0.0) < 0.05,
  "with the floor at 0 the old behaviour returns (entrants can arrive at exactly 0)");

// The floor is NOT AI-gated, so it moves the baseline — the stationary
// calibration has to survive it. Guards the whole meanE_shortfall story.
//
// Must be checked on the WORLD-MODEL graph at production N: the stationary
// ridge sits somewhere else on a BA graph (see calibrate_time_base.js), and
// MONTHLY_TICK_PARAMS was only ever calibrated for this configuration. Checked
// on BA at N=3000 the same parameters drift 0.018, which says nothing about
// whether the experiment set is sound.
{
  const s = initSim(Object.assign({}, MONTHLY_TICK_PARAMS, {
    N: 10504, seed: 11, turnoverRate: 1 / 480, aiEnabled: false,
    graphSource: "worldModel", worldModel: wm, institutionSizing: "weighted" }));
  let early = null, late = null;
  for (let i = 1; i <= 1440; i++) { const h = tick(s); if (i === 120) early = h.meanE; if (i === 1440) late = h.meanE; }
  const drift = Math.abs(late - early);
  assert(drift <= 0.010, `no-AI baseline stays stationary with the entrant floor (drift ${drift.toFixed(4)} <= 0.010)`);
}

// P19 regression: maximum de-skilling must not be a discontinuity. The failure it
// guards was a 70x step in meanE across the last step of the old rho sweep, so it is
// compared as a RATIO between adjacent points. With rho and the atrophy branch both
// gone, maximum de-skilling is simply gamma_below = 0 and the endpoint is stated as
// that alone.
{
  const wmRunAI = (gammaBelow) => {
    const st = initSim({ N: 2500, seed: 3, graphSource: "worldModel", worldModel: wm,
      institutionSizing: "weighted", transferRate: 0.15, decayRate: 0.020,
      turnoverRate: 1 / 480, aiEnabled: true, aiDampeningAbove: 1,
      aiLevelFraction: ET, aiDampeningBelow: gammaBelow });
    for (let i = 0; i < 600; i++) tick(st);
    return st.history[st.history.length - 1].meanE;
  };
  const nearMax = wmRunAI(0.1);   // learning almost blocked
  const atMax = wmRunAI(0.0);     // learning fully blocked
  const ratio = nearMax / atMax;
  assert(ratio < 3, `fully-blocked learning is a smooth endpoint, not an absorbing state (meanE ratio is ${ratio.toFixed(2)}x, was ~70x)`);
}

// --- 14. the bundled copy of the data must match its sources -----------------
// simulator.html loads world-model-data.js so the graph is ready on open. That file
// is generated, and world-model.json is EXPECTED to change (hence its fingerprint),
// so a stale bundle would quietly serve an older world to anyone using the page while
// batch_run.js used the current one.
console.log("\n--- bundled world-model-data.js is current ---");
{
  const { execFileSync } = require("child_process");
  let ok = true, detail = "";
  try {
    execFileSync(process.execPath, [paths.src("build_world_model_data.js"), "--check"], { stdio: "pipe" });
  } catch (e) {
    ok = false;
    detail = (e.stderr ? e.stderr.toString() : e.message).trim();
  }
  assert(ok, "world-model-data.js matches world-model.json + mobility-costs.json" + (ok ? "" : " — " + detail));
}

console.log(`\n${fail === 0 ? "ALL CHECKS PASSED" : fail + " CHECK(S) FAILED"}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
