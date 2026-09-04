// Generates data/experiments-entrant/entrant.1.json .. entrant.6.json — the ENTRANT
// EXPERTISE set: what the quality of new arrivals does to a field, and how that interacts
// with the two AI dials the model's central claim runs on.
//
//   node src/generate_entrant_experiments.js
//
// WHY THIS SET. Everything else in the study varies what happens to people once they are
// in the field. This varies who ARRIVES. It matters because the entrant distribution is
// the only source of new expertise the model has: everyone else is either climbing toward
// their institution's teaching level or decaying away from it, so where entrants start
// sets the bottom of the ladder that the whole equilibrium rests on.
//
// The pairing is deliberate. gamma_below is the channel AI crowds out ENTRANT learning
// through, and lambda decides who counts as below the AI at all — so both act on exactly
// the population these three parameters define. A grid of the two against each other is
// the interaction worth having.
//
// THE THREE PARAMETERS, and what each is actually asking:
//
//   entrantExpertiseMean    how good new arrivals are on average.
//   entrantExpertiseSpread  how much they differ from one another. A wide draw puts some
//                           entrants near the expert threshold on day one and others at
//                           the floor; a narrow one makes every cohort alike.
//   entrantExpertiseFloor   the lower bound on a draw. Not cosmetic: the draw is
//                           skew-normal clipped to [0,1], so without a floor a
//                           low-mean/wide-spread combination piles entrants at exactly
//                           E = 0, which is what fed the absorbing state at maximum
//                           de-skilling (problems.md P19/R11). Sweeping it says how much
//                           of the model's behaviour at the bottom is that clipping.
//
// A NOTE ON THE FLOOR AXIS. The floor and the mean are not independent: where the floor
// exceeds the mean, most of the draw is clipped and the realised entrant distribution is a
// spike at the floor rather than anything centred on the mean. That is a real regime, not
// a bug, but the floor pairings pin the mean at its calibrated 0.05 — so the upper half of
// the floor axis IS that spike regime, and should be read as "every entrant arrives at
// exactly the floor" rather than as a shifted distribution.
"use strict";
const fs = require("fs");
const path = require("path");
const { EXPERT_THRESHOLD, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS, WORLD_MODEL_PARAMS,
        TICKS_PER_YEAR, CAREER_YEARS, FIELD_DIVISOR } = require("./engine.js");
const { loadWorldModel, suggestedN } = require("./world_model.js");
const paths = require("./paths.js");

const OUT_DIR = paths.data("experiments-entrant");
const HORIZON = 1440;                        // 3 careers, as the other sweep sets
const REPLICATES = 3;
const SEED = 1;
// 11, not the world-model set's 21. Six pairings at 21x21x3x2 would be 15,876 runs; at 11
// it is 4,356, which is an evening rather than a weekend, and these axes have no sharp
// transition that 11 levels would alias. Raise it if one shows up.
const GRID = 11;

const RECORD_AT = [];
for (let t = TICKS_PER_YEAR; t <= HORIZON; t += TICKS_PER_YEAR) RECORD_AT.push(t);

const INTAKE_DERIVED_N = (() => {
  const wm = loadWorldModel(
    JSON.parse(fs.readFileSync(paths.data("world-model.json"), "utf8")),
    JSON.parse(fs.readFileSync(paths.data("mobility-costs.json"), "utf8")));
  return suggestedN(wm, CAREER_YEARS, FIELD_DIVISOR);
})();

function linspace(lo, hi, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(+(lo + (hi - lo) * (i / (n - 1))).toFixed(6));
  return out;
}

const STUDY_PARAMS = {
  // Floors at the calibrated 0.05 rather than 0, for the reason entrantExpertiseFloor
  // exists at all. Tops out at 0.5, comfortably below EXPERT_THRESHOLD: an entrant
  // arriving already expert is a different model, not a harder version of this one.
  entrantExpertiseMean: { label: "entrant expertise, mean", values: linspace(0.05, 0.5, GRID), default: 0.05 },
  // From near-identical cohorts to a draw wide enough to straddle the expert threshold.
  entrantExpertiseSpread: { label: "entrant expertise, spread", values: linspace(0.01, 0.30, GRID), default: 0.05 },
  // 0 is the pre-2026-08 behaviour (entrants can arrive at exactly 0); the top of the
  // range is the spike regime described in the header.
  entrantExpertiseFloor: { label: "entrant expertise, floor", values: linspace(0, 0.30, GRID), default: 0.05 },
  // The AI axes. Same ranges as the world-model set, so a cell here is comparable with a
  // cell there.
  aiDampeningBelow: { label: "gamma_below", values: linspace(0, 2, GRID), default: 0.75 },
  aiLevelFraction: { label: "lambda", values: linspace(0.01, 1, GRID), default: EXPERT_THRESHOLD },
};

const BASE_FIXED = Object.assign({
  graphSource: "worldModel",
  institutionSizing: "weighted",
  expertiseMean: 0.28,
  expertiseSpread: 0.30,
  expertiseSkew: 3,
  mobilityMode: "hybrid",
  jumpProbability: 0.10,
  competitionAversion: 0.5,
  prestigeWeight: 0.3,
  aiDampeningAbove: 1.0,
}, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS, WORLD_MODEL_PARAMS, { N: INTAKE_DERIVED_N });

const WORLD_MODEL = {
  worldModelPath: "world-model.json",
  mobilityCostsPath: "mobility-costs.json",
  worldModelOptions: {
    useBlocAffinity: true, hubSource: "located_in", prestigeFrom: "intake",
    zeroIntakePolicy: "floor1", useExplicitEdges: true,
  },
};

// Experiment NUMBERS are stable identities: results/entrant.N/ holds finished CSVs and the
// report indexes them by that number, so a number must always mean the same pairing.
// Every entrant parameter against every AI axis, entrant parameter varying fastest.
// APPEND here; never insert or reorder.
const ENTRANT_KEYS = ["entrantExpertiseMean", "entrantExpertiseSpread", "entrantExpertiseFloor"];
const AI_KEYS = ["aiDampeningBelow", "aiLevelFraction"];
const PAIRS = [];
AI_KEYS.forEach((ai) => ENTRANT_KEYS.forEach((e) => PAIRS.push([e, ai])));

fs.mkdirSync(OUT_DIR, { recursive: true });
const manifest = { set: "entrant", replicates: REPLICATES, horizon: HORIZON, seed: SEED,
  recordAt: RECORD_AT, worldModel: WORLD_MODEL, ticksPerYear: TICKS_PER_YEAR,
  careerYears: CAREER_YEARS, graphSource: "worldModel", experiments: [] };

PAIRS.forEach(([xKey, yKey], i) => {
  const n = i + 1;
  const fixed = Object.assign({}, BASE_FIXED);
  // Every study parameter this pairing does NOT sweep is pinned at its default. Written
  // into the config rather than left to the engine's own default, so the file states the
  // whole model it was run under and a later change to DEFAULT_PARAMS cannot silently
  // reinterpret an archived result.
  Object.keys(STUDY_PARAMS).forEach((k) => {
    if (k !== xKey && k !== yKey) fixed[k] = STUDY_PARAMS[k].default;
  });
  const cfg = {
    mode: "grid",
    replicates: REPLICATES,
    horizon: HORIZON,
    recordAt: RECORD_AT,
    seed: SEED,
    pairWithBaseline: true,
    worldModel: WORLD_MODEL,
    fixed,
    params: {
      [xKey]: { values: STUDY_PARAMS[xKey].values },
      [yKey]: { values: STUDY_PARAMS[yKey].values },
    },
  };
  fs.writeFileSync(path.join(OUT_DIR, `entrant.${n}.json`), JSON.stringify(cfg, null, 2));
  const cells = STUDY_PARAMS[xKey].values.length * STUDY_PARAMS[yKey].values.length;
  manifest.experiments.push({
    n, x: xKey, y: yKey, cells, runs: cells * REPLICATES * 2,
    title: `${STUDY_PARAMS[xKey].label} x ${STUDY_PARAMS[yKey].label}`,
  });
  console.log(`entrant.${n}.json  ${xKey} x ${yKey}  — ${cells} cells, ${cells * REPLICATES * 2} runs`);
});

const fmtRange = (k) => {
  const v = STUDY_PARAMS[k].values;
  return v[0] + " to " + v[v.length - 1] + ", " + v.length + " levels";
};
const ENT_RANGE = {};
Object.keys(STUDY_PARAMS).forEach((k) => { ENT_RANGE[k] = fmtRange(k); });

manifest.studyParams = STUDY_PARAMS;
manifest.baseFixed = BASE_FIXED;
// A separate page rather than a block printed above the grid: build_report.js writes
// doc/entrant_notes.html from this and the report links to it. Method notes are worth
// having beside the numbers and worth reading once; they are not worth the space above
// the figure on every load afterwards.
//
// Written here, from the constants the configs are built from, so the grid sizes and
// horizons it quotes cannot drift from the runs it describes.
manifest.notesPage = {
  file: "entrant_notes.html",
  title: "Entrant expertise set: definitions and method",
  html: `
  <h2>Scope</h2>
  <p>The set varies the distribution from which replacement agents are drawn at turnover,
  crossed with the two AI parameters that act on agents below the AI's level.</p>

  <h2>Rationale</h2>
  <p>Entrant draws are the only mechanism in the model that introduces expertise not
  derived from an agent already present. Every other agent moves toward its institution's
  teaching level or decays away from it, so the entrant distribution sets the lower
  boundary of the equilibrium distribution. Its parameters have not previously been swept
  against the AI channels.</p>

  <h2>Parameters varied</h2>
  <table>
    <tr><th>Parameter</th><th>Range</th><th>Definition</th></tr>
    <tr><td><code>entrantExpertiseMean</code></td><td>${ENT_RANGE.entrantExpertiseMean}</td>
        <td>Mean of the entrant draw. The upper bound is below the expert threshold
        (${EXPERT_THRESHOLD}); entrants arriving already expert would be a different
        model.</td></tr>
    <tr><td><code>entrantExpertiseSpread</code></td><td>${ENT_RANGE.entrantExpertiseSpread}</td>
        <td>Spread of the draw. At the upper end the draw straddles the expert
        threshold.</td></tr>
    <tr><td><code>entrantExpertiseFloor</code></td><td>${ENT_RANGE.entrantExpertiseFloor}</td>
        <td>Lower bound applied after the draw. Zero reproduces the pre-2026-08
        behaviour, in which entrants could arrive at exactly E = 0.</td></tr>
    <tr><td><code>aiDampeningBelow</code></td><td>${ENT_RANGE.aiDampeningBelow}</td>
        <td>Multiplier on the learning increment for agents below the AI's level. 1 is no
        effect; below 1 dampens, above 1 amplifies.</td></tr>
    <tr><td><code>aiLevelFraction</code></td><td>${ENT_RANGE.aiLevelFraction}</td>
        <td>The AI's level, as a fraction of the highest expertise in the starting
        population. Determines which agents <code>aiDampeningBelow</code> governs.</td></tr>
  </table>
  <p>Both AI axes act on the population the entrant parameters define, which is the reason
  for the pairing.</p>

  <h2>Interaction between floor and mean</h2>
  <p>The floor and the mean are not independent. The draw is skew-normal clipped to
  [0, 1]; where the floor exceeds the mean, most of the draw is clipped and the realised
  entrant distribution is a point mass at the floor rather than a distribution centred on
  the mean. The floor pairings pin the mean at its calibrated value of
  ${STUDY_PARAMS.entrantExpertiseMean.default}, so the upper half of the floor axis is that
  regime and should be read as every entrant arriving at the floor.</p>
  <p>Without a floor, a low mean combined with a wide spread concentrates entrants at
  exactly zero. That clipping fed the absorbing state observed at maximum de-skilling
  (problems.md P19/R11). Sweeping the floor separates the contribution of the clipping from
  that of the mechanism.</p>

  <h2>Design</h2>
  <p>${PAIRS.length} experiments: ${ENTRANT_KEYS.length} entrant parameters against
  ${AI_KEYS.length} AI parameters. Each is a ${GRID} x ${GRID} grid at ${REPLICATES}
  replicates, horizon ${HORIZON} ticks. One tick is one month, so the horizon is
  ${HORIZON / TICKS_PER_YEAR} years, approximately three careers at the
  ${CAREER_YEARS}-year career length used throughout. Total
  ${(PAIRS.length * GRID * GRID * REPLICATES * 2).toLocaleString()} runs.</p>
  <p>Paired design: each cell is run twice from the same seed, once with AI enabled and
  once without, so the two arms share their initial population and their random stream.
  Parameters not varied by a given pairing are pinned at the defaults listed above and
  written into each config file, so an archived result is not reinterpreted by a later
  change to the engine's defaults.</p>

  <h2>Metrics</h2>
  <p>Panels labelled <i>change</i> are the difference between the two arms. Panels labelled
  <i>(no AI)</i> are absolute values from the baseline arm. Both are shown because the
  entrant parameters move the baseline across a wide range: a given AI effect is not
  equivalent in a field at meanE 0.40 and one at 0.65, and the change panels alone do not
  distinguish those cases.</p>
  <p>Capability is reported as a fractional change rather than in absolute
  expert-equivalents, since cells differ several-fold in how much capability they hold.
  See the capability ratio sensitivity results for how far capability magnitudes depend on
  the assumed ratio between the expert threshold and the ceiling.</p>
`,
};
fs.writeFileSync(paths.data("experiments.entrant.manifest.json"), JSON.stringify(manifest, null, 2));
const total = manifest.experiments.reduce((s, e) => s + e.runs, 0);
console.log(`\nwrote ${path.relative(paths.ROOT, OUT_DIR)}/ and data/experiments.entrant.manifest.json`);
console.log(`${manifest.experiments.length} experiments, ${total.toLocaleString()} runs, horizon ${HORIZON}, N=${INTAKE_DERIVED_N}`);
