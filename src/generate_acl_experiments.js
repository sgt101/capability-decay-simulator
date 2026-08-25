// Generates the ACL scenario set: the focus results for the paper.
//
//   node src/generate_acl_experiments.js
//
// NOT A SWEEP. The other two sets scan parameter space to find shape; this one runs a
// small number of NAMED scenarios drawn from two empirical sources, so each cell is a
// claim someone has made about the world rather than a point on a grid.
//
//   Stromberg    three measured learning penalties for people below the AI's level.
//                Stated as percentages and converted here: a -16.15% penalty is a
//                gamma_below of 1 - 0.1615 = 0.8385, because gamma is stored as a
//                multiplier on the learning delta (0..2, 1 = unaffected) and shown to
//                the reader as multiplier - 1.
//
//   Dell'Acqua   the capability side, in three versions: as published, weaker than
//                published, and no effect at all. Together they ask how much of the
//                answer rests on that study being right.
//
// LAYOUT. Four dimensions, and a heatmap has two. The grids are lambda x gamma_below;
// what separates one experiment from the next is the capability assumption and the
// gamma_above scenario, both HELD FIXED within an experiment and named in its label.
"use strict";
const fs = require("fs");
const path = require("path");
const { MONTHLY_TICK_PARAMS, PIPELINE_PARAMS, WORLD_MODEL_PARAMS,
        TICKS_PER_YEAR, CAREER_YEARS } = require("./engine.js");
const paths = require("./paths.js");

const OUT_DIR = paths.data("experiments-acl");
const HORIZON = 1440;                       // 3 careers, matching the other sets
const RECORD_AT = [];
for (let t = TICKS_PER_YEAR; t <= HORIZON; t += TICKS_PER_YEAR) RECORD_AT.push(t);
// 10, not the 3-5 the sweep sets use. This is the set the paper cites, it is only ~6
// CPU-hours at this size, and halving the replicate noise is worth an hour.
const REPLICATES = 10;
const SEED = 1;

// --- the grid axes ----------------------------------------------------------------
const PCT_TO_GAMMA = (pct) => Math.round((1 + pct / 100) * 1e6) / 1e6;
const STROMBERG_PCT = [-16.15, -18.87, -23.64];

const AXES = {
  // How good the AI is, as a fraction of the strongest starting human. Note this drives
  // BOTH who is dampened AND the frontier F = lambda^frontierBreadth, so it moves the
  // capability leverage as well — at lambda 0.2 even published Dell'Acqua leaves a
  // novice worse off, because a weak AI covers too little of the work to offset the
  // errors it introduces.
  // Tops out at 0.875, not 0.95. Measured on this graph at the 120-year horizon, the
  // share of the field ABOVE the AI — the only people gamma_above governs — runs
  // 9.5% at lambda 0.80, 4.1% at 0.85, 2.4% at 0.875, then 0.7% at 0.90 and exactly
  // 0% at 0.95. Past 0.875 the gamma_above scenarios that separate one experiment from
  // the next stop separating anything, and five of the fifteen experiments would carry
  // an identical right-hand column. This is problems.md P16 seen from the other side.
  aiLevelFraction: { values: [0.2, 0.4, 0.6, 0.8, 0.85, 0.875] },
  aiDampeningBelow: { values: STROMBERG_PCT.map(PCT_TO_GAMMA) },
};

// --- what separates one experiment from the next ----------------------------------
const CAPABILITY_VARIANTS = [
  ["published", "Dell'Acqua as published", { aclNoviceGain: 0.43, aclExpertGain: 0.17, aclNoviceDeficit: 0.19 }],
  ["weak", "Dell'Acqua is weak", { aclNoviceGain: 0.15, aclExpertGain: 0.05, aclNoviceDeficit: 0.40 }],
  ["wrong", "Dell'Acqua is wrong", { aclNoviceGain: 0.00, aclExpertGain: 0.00, aclNoviceDeficit: 0.00 }],
];

// Shown to the reader as gamma_above - 1, so +0.1 means AI teaches experts 10% faster
// than colleagues alone would.
const ABOVE_SCENARIOS = [0.1, 0.0, -0.1, -0.2, -0.3];

const BASE_FIXED = Object.assign({
  graphSource: "worldModel",
  institutionSizing: "weighted",
  expertiseSpread: 0.30,
  expertiseSkew: 3,
  entrantExpertiseSpread: 0.05,
  entrantExpertiseFloor: 0.05,
  mobilityMode: "hybrid",
  jumpProbability: 0.10,
  competitionAversion: 0.5,
  prestigeWeight: 0.3,
  // The frontier follows the AI's level exactly. Not swept: F = lambda^1 is the
  // coupling this model asserts, and lambda is already an axis.
  frontierBreadth: 1,
}, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS, WORLD_MODEL_PARAMS);
delete BASE_FIXED.M;   // derived from the world model; stating it throws

const WORLD_MODEL = {
  worldModelPath: "world-model.json",
  mobilityCostsPath: "mobility-costs.json",
  worldModelOptions: {
    useBlocAffinity: true, hubSource: "located_in", prestigeFrom: "intake",
    zeroIntakePolicy: "floor1", useExplicitEdges: true,
  },
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const manifest = [];
let n = 0;

// Ordered variant-major so the three capability assumptions sit together in the list.
CAPABILITY_VARIANTS.forEach(([key, variantLabel, aclParams]) => {
  ABOVE_SCENARIOS.forEach((above) => {
    n++;
    const fixed = Object.assign({}, BASE_FIXED, aclParams, {
      aiDampeningAbove: Math.round((1 + above) * 1e6) / 1e6,
    });
    const label = `${variantLabel} · γ_above ${above >= 0 ? "+" : ""}${above.toFixed(1)}`;
    const config = {
      mode: "grid", replicates: REPLICATES, horizon: HORIZON, recordAt: RECORD_AT,
      seed: SEED, pairWithBaseline: true, worldModel: WORLD_MODEL, fixed,
      params: {
        aiLevelFraction: { values: AXES.aiLevelFraction.values },
        aiDampeningBelow: { values: AXES.aiDampeningBelow.values },
      },
    };
    const runs = AXES.aiLevelFraction.values.length * AXES.aiDampeningBelow.values.length * REPLICATES * 2;
    fs.writeFileSync(path.join(OUT_DIR, `acl.${n}.json`), JSON.stringify(config, null, 2) + "\n");
    manifest.push({
      n, file: `data/experiments-acl/acl.${n}.json`,
      x: "aiLevelFraction", y: "aiDampeningBelow", label, variant: key, gammaAbove: above,
      xValues: AXES.aiLevelFraction.values, yValues: AXES.aiDampeningBelow.values, runs,
    });
  });
});

fs.writeFileSync(
  paths.data("experiments.acl.manifest.json"),
  JSON.stringify({
    graphSource: "worldModel", worldModel: WORLD_MODEL,
    note: "Named scenarios from Stromberg (learning penalties) and Dell'Acqua (capability leverage). "
      + "Not a sweep: every cell is a stated empirical claim. Grids are lambda x gamma_below; the "
      + "capability variant and the gamma_above scenario are fixed within an experiment.",
    ticksPerYear: TICKS_PER_YEAR, careerYears: CAREER_YEARS,
    stromberg: { statedPercent: STROMBERG_PCT, asGammaBelow: STROMBERG_PCT.map(PCT_TO_GAMMA) },
    capabilityVariants: CAPABILITY_VARIANTS.map(([k, l, p]) => ({ key: k, label: l, params: p })),
    aboveScenarios: ABOVE_SCENARIOS,
    studyParams: AXES, baseFixed: BASE_FIXED,
    replicates: REPLICATES, horizon: HORIZON, recordAt: RECORD_AT,
    experiments: manifest,
  }, null, 2) + "\n"
);

const stale = fs.readdirSync(OUT_DIR)
  .filter((f) => /^acl\.\d+\.json$/.test(f))
  .filter((f) => !manifest.some((m) => path.basename(m.file) === f));
stale.forEach((f) => fs.unlinkSync(path.join(OUT_DIR, f)));

const total = manifest.reduce((s, m) => s + m.runs, 0);
console.log(`wrote ${manifest.length} ACL scenario files -> ${OUT_DIR}`);
CAPABILITY_VARIANTS.forEach(([, l]) => {
  const mine = manifest.filter((m) => m.label.startsWith(l));
  console.log(`  ${l}: acl.${mine[0].n}-${mine[mine.length - 1].n}  (γ_above ${ABOVE_SCENARIOS.map((a) => (a >= 0 ? "+" : "") + a).join(", ")})`);
});
if (stale.length) console.log(`  removed ${stale.length} stale config(s)`);
console.log(`\ngrid: λ ${AXES.aiLevelFraction.values.join(", ")}`);
console.log(`   x  γ_below ${AXES.aiDampeningBelow.values.join(", ")}  (Stromberg ${STROMBERG_PCT.join("%, ")}%)`);
console.log(`${REPLICATES} replicates, horizon ${HORIZON} = ${HORIZON / TICKS_PER_YEAR}y, paired with a no-AI baseline`);
console.log(`total ${total.toLocaleString()} runs`);
