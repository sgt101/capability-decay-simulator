// Generates the STRUCTURE set: every AI parameter crossed with the two knobs that
// describe the shape of the institutional network — M (how many institutions) and
// graphAttachment / m (how densely a new one connects).
//
//   node src/generate_structure_experiments.js
//
// The question it exists to answer: the world-model set holds structure FIXED at the
// real graph's 245 institutions, so it can say what AI does to a field but not whether
// that answer depends on how the field is arranged. This set varies the arrangement.
//
// BARABASI-ALBERT ONLY, and not by preference. In world-model mode M is derived from
// the data and initSim throws if a config also states it, and graphAttachment is only
// read when a BA graph is generated. A structure sweep is therefore expressible on the
// generated graph and nowhere else.
//
// Its own directory and its own numbering. generate_worldmodel_experiments.js DELETES
// any experiment.N.json under data/experiments/ that is not in its manifest, so a
// second set living there would be destroyed the next time that one ran.
"use strict";
const fs = require("fs");
const path = require("path");
const { MONTHLY_TICK_PARAMS, PIPELINE_PARAMS, TICKS_PER_YEAR, CAREER_YEARS,
        EXPERT_THRESHOLD } = require("./engine.js");
const paths = require("./paths.js");

const OUT_DIR = paths.data("experiments-structure");
const HORIZON = 1440;                       // 3 careers, matching the other sets
const RECORD_AT = [];
for (let t = TICKS_PER_YEAR; t <= HORIZON; t += TICKS_PER_YEAR) RECORD_AT.push(t);
// 5, not the 3 the other sets use. Replicate noise falls as 1/sqrt(n), so this buys a
// ~22% narrower error on every cell for a 67% larger run — worth it here because the
// structural effects being measured are small next to the AI ones: capability loss
// moves ~30 points across the whole M axis, where a dampening sweep moves ~100.
const REPLICATES = 5;
const SEED = 1;

// N is fixed across the whole set so that M alone moves the people-per-institution
// figure — that IS the structural variable, and letting N drift would confound it.
//
// 4,000 with M capped at 132 keeps every institution meaningfully occupied. Measured at
// the corners over the full horizon: at M=132 the emptiest institution still holds 6
// people and nothing falls under MIN_MEANINGFUL_OCCUPANCY. Pushing M to 252 was tried
// and left 9-11 institutions below that floor, which engine.js says makes their internal
// dynamics noise — so the range stops short of it rather than reporting suspect cells.
const N = 4000;

function range(lo, hi, step) {
  const out = [];
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i++) out.push(Math.round((lo + i * step) * 1e8) / 1e8);
  return out;
}

// --- the two structural axes -----------------------------------------------------
// GEOMETRIC, not uniform. Measured, the quantities that respond to M respond to its
// ORDER OF MAGNITUDE: mean teaching level runs 0.73 at M=132 to 0.98 at M=3, and the
// share of capability AI destroys runs 90% to 58% over the same span — but both curves
// flatten below M ~ 12, so a uniform 12..132 axis spent every one of its points on the
// straight part and none on the knee. Geometric spacing puts half the samples under
// M = 24, where the shape actually is.
//
// Stops at 3 rather than 2. At M = 2 the graph is a single edge and `divergence` — the
// variance of institution means — is computed over two numbers, which is not a variance
// anyone should read off a heatmap.
function geometric(lo, hi, n) {
  return [...new Set(Array.from({ length: n }, (_, i) => Math.round(lo * Math.pow(hi / lo, i / (n - 1)))))];
}
const M_VALUES = geometric(3, 132, 21);          // 20 distinct: 3,4,5,6,8,...,109,132

const STRUCTURE_PARAMS = {
  M: { values: M_VALUES, default: 40 },
  graphAttachment: { values: range(1, 11, 1), default: 2 },   // mean degree ~2..22
};

// generateBAGraph clamps m to M-1 SILENTLY, so a cell with m >= M records one attachment
// value in its CSV and ran at another — the config and the run disagreeing without a
// word. Wherever m is a swept axis, M is therefore restricted to values that exceed the
// largest m. Everywhere else m is fixed at its default of 2, which only requires M >= 3.
const MAX_M_ATTACH = Math.max(...STRUCTURE_PARAMS.graphAttachment.values);
const M_VALUES_WITH_ATTACH = M_VALUES.filter((v) => v > MAX_M_ATTACH);

// --- the AI axes -------------------------------------------------------------------
const AI_PARAMS = {
  aiLevelFraction: { values: range(0.05, 1.0, 0.05), default: EXPERT_THRESHOLD },
  // Slider-space 0..2, shown to the reader as -1..+1. 1.0 is neutral.
  aiDampeningBelow: { values: range(0, 2, 0.1), default: 1.0 },
  aiDampeningAbove: { values: range(0, 2, 0.1), default: 1.0 },
  // A READ-OUT axis, and the only one here that is. frontierBreadth enters aclLeverage
  // and nothing else, so it cannot move meanE or shareExpert by a single tick — those
  // columns are identical down its whole range BY CONSTRUCTION, and a flat result there
  // is the expected answer rather than a null finding. It is swept for what it does to
  // systemCapability, which is why that metric had to be added to batch_run first.
  frontierBreadth: { values: range(0.25, 3.0, 0.25), default: 1 },
};

// Both dampening dials sit at 1.0 (neutral) whenever they are not the axis under study.
// The Barabasi-Albert set learned this the hard way and records it in its header: pinned
// at maximum dampening instead, shareExpert read a flat 0.000 across the ENTIRE range of
// whatever else was being swept, leaving most experiments structurally unable to show
// their own parameter's effect. A structure sweep against a pre-collapsed field would
// measure nothing at all.
const BASE_FIXED = Object.assign({
  graphSource: "ba",
  expertiseSpread: 0.30,
  expertiseSkew: 3,
  entrantExpertiseSpread: 0.05,
  entrantExpertiseFloor: 0.05,
  mobilityMode: "hybrid",
  jumpProbability: 0.10,
  competitionAversion: 0.5,
  prestigeWeight: 0.3,
  baseMoveProb: 0.01,
}, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS, { N });

// Pair order is the file numbering, so it is written out rather than derived from key
// iteration: structure.N must keep meaning the same pair if an axis is ever added.
const PAIRS = [
  ["aiLevelFraction", "M"],
  ["aiLevelFraction", "graphAttachment"],
  ["aiDampeningBelow", "M"],
  ["aiDampeningBelow", "graphAttachment"],
  ["aiDampeningAbove", "M"],
  ["aiDampeningAbove", "graphAttachment"],
  ["frontierBreadth", "M"],
  ["frontierBreadth", "graphAttachment"],
  // The structural control. No AI parameter varies, so this is what M and m do to the
  // field on their own — the baseline movement every other experiment here has to be
  // read against. problems.md P18 is the reason it exists: four of the world-model
  // study's parameters turned out to move the no-AI arm as much as the AI one, and a
  // shortfall quoted without its baseline cannot tell those apart.
  ["M", "graphAttachment"],
];

const ALL = Object.assign({}, AI_PARAMS, STRUCTURE_PARAMS);

fs.mkdirSync(OUT_DIR, { recursive: true });
const manifest = [];

PAIRS.forEach(([a, b], idx) => {
  const n = idx + 1;
  const fixed = Object.assign({}, BASE_FIXED);
  Object.keys(ALL).forEach((k) => { if (k !== a && k !== b) fixed[k] = ALL[k].default; });

  // The M axis is narrowed only where m is the other axis — see M_VALUES_WITH_ATTACH.
  const valuesFor = (k) =>
    (k === "M" && (a === "graphAttachment" || b === "graphAttachment")) ? M_VALUES_WITH_ATTACH : ALL[k].values;

  // Every cell must be runnable as written. This is asserted rather than trusted
  // because the failure is silent: the run succeeds, the CSV looks fine, and the
  // attachment column is simply wrong.
  const mValues = a === "M" || b === "M" ? valuesFor("M") : [fixed.M];
  const aValues = a === "graphAttachment" || b === "graphAttachment"
    ? valuesFor("graphAttachment") : [fixed.graphAttachment];
  for (const M of mValues) {
    for (const att of aValues) {
      if (att >= M) throw new Error(`[gen-structure] ${a} x ${b}: cell M=${M}, graphAttachment=${att} `
        + `would be silently clamped to m=${M - 1} by generateBAGraph`);
    }
  }

  const config = {
    mode: "grid",
    replicates: REPLICATES,
    horizon: HORIZON,
    recordAt: RECORD_AT,
    seed: SEED,
    // Every cell is run twice on the same seed, AI on and off. aiEnabled is set by
    // batch_run itself and must not appear in fixed/params.
    pairWithBaseline: true,
    fixed,
    params: { [a]: { values: valuesFor(a) }, [b]: { values: valuesFor(b) } },
  };

  const runs = valuesFor(a).length * valuesFor(b).length * REPLICATES * 2;
  fs.writeFileSync(path.join(OUT_DIR, `structure.${n}.json`), JSON.stringify(config, null, 2) + "\n");
  // The ACTUAL axis values for this experiment, not just the axis names. studyParams
  // carries the full M axis, but experiments that sweep m use a restricted one, so the
  // manifest alone cannot say what a given grid should contain. build_report.js compares
  // these against the CSV and refuses a mismatch — which is what catches results left
  // over from a previous generation with a different axis.
  manifest.push({ n, file: `data/experiments-structure/structure.${n}.json`, x: a, y: b, runs,
    xValues: valuesFor(a), yValues: valuesFor(b) });
});

fs.writeFileSync(
  paths.data("experiments.structure.manifest.json"),
  JSON.stringify({
    graphSource: "ba",
    note: "AI parameters crossed with network structure (M, graphAttachment). BA graph only — "
      + "M is derived from the data in world-model mode and graphAttachment is unread there.",
    ticksPerYear: TICKS_PER_YEAR, careerYears: CAREER_YEARS,
    N, aiParams: AI_PARAMS, structureParams: STRUCTURE_PARAMS, baseFixed: BASE_FIXED,
    // The two above, merged. build_report.js reads studyParams to size the grid and to
    // list what was held fixed for each experiment, and it should not have to know that
    // this set happens to file its axes under two headings.
    studyParams: ALL,
    replicates: REPLICATES, horizon: HORIZON, recordAt: RECORD_AT,
    experiments: manifest,
  }, null, 2) + "\n"
);

// Stale configs from an earlier generation would otherwise be picked up by the runner
// and executed against a pairing this file no longer defines.
const stale = fs.readdirSync(OUT_DIR)
  .filter((f) => /^structure\.\d+\.json$/.test(f))
  .filter((f) => !manifest.some((m) => path.basename(m.file) === f));
stale.forEach((f) => fs.unlinkSync(path.join(OUT_DIR, f)));

const totalRuns = manifest.reduce((s, m) => s + m.runs, 0);
console.log(`wrote ${manifest.length} structure experiment files -> ${OUT_DIR}`);
manifest.forEach((m) => console.log(`  structure.${m.n}: ${m.x} x ${m.y}  (${m.runs.toLocaleString()} runs)`));
console.log(`  + experiments.structure.manifest.json`);
if (stale.length) console.log(`  removed ${stale.length} stale config(s): ${stale.join(", ")}`);
console.log(`\nN = ${N.toLocaleString()}, fixed across the set so M alone moves people-per-institution`);
console.log(`M ${STRUCTURE_PARAMS.M.values[0]}..${STRUCTURE_PARAMS.M.values.slice(-1)[0]}`
  + ` = ${(N / STRUCTURE_PARAMS.M.values[0]).toFixed(0)}..${(N / STRUCTURE_PARAMS.M.values.slice(-1)[0]).toFixed(0)} people each`);
console.log(`M axis: ${M_VALUES.length} geometric values, ${M_VALUES.filter((v) => v < 24).length} of them below M=24 where the curves bend`);
console.log(`m ${STRUCTURE_PARAMS.graphAttachment.values[0]}..${MAX_M_ATTACH}; where m is swept, M is restricted to`
  + ` ${M_VALUES_WITH_ATTACH[0]}..${M_VALUES_WITH_ATTACH.slice(-1)[0]} (${M_VALUES_WITH_ATTACH.length} values) so m < M always`);
console.log(`horizon ${HORIZON} = ${HORIZON / TICKS_PER_YEAR}y = ${(HORIZON / (CAREER_YEARS * TICKS_PER_YEAR)).toFixed(1)} careers, ${REPLICATES} replicates`);
console.log(`total ${totalRuns.toLocaleString()} runs`);
