// Generates experiments-ABGraph/experiment.1.json ... experiment.N.json — one
// file per UNORDERED pair of the eleven parameters under study (11 choose 2 = 55
// pairs; A x B and B x A would be the same grid transposed, not new information, so
// they're not both generated). Each is a 2D heatmap: paramA x paramB ->
// shortfall. experiment.1..15 are the original six-parameter set and keep
// their original numbering; experiment.16..55 cover the five parameters
// added afterward (see STUDY_PARAMS below for why each was added last, not
// interleaved).
//
// The other nine of the eleven study parameters are held at their per-param
// `default` (see STUDY_PARAMS) for that file — usually the engine.js default.
// aiDampeningBelow/Above used to default to 0.0 (worst-case AI, per an earlier
// explicit steer) but that was found to swamp every non-dampening experiment: with
// both pinned at max dampening, shareExpert_treatment reads a flat 0.000 across the
// ENTIRE range of whatever else is being swept (checked directly — e.g. the full
// turnoverRate axis moved meanE by only 0.025 total and shareExpert not at all),
// making most of the 55 experiments structurally unable to show the other parameter's
// effect on that metric. Now defaults to 1.0/1.0 (neutral — no dampening at all)
// instead, per a later steer, so non-dampening experiments show what that parameter
// actually does against an unbiased AI backdrop, not a pre-collapsed one. Everything
// outside the eleven (N, M, graph, mobility, ...) is pinned the same way across every
// experiment via BASE_FIXED, so the only things that vary between experiment
// files are exactly the two parameters that file is about.
//
// Regenerate after editing STUDY_PARAMS or BASE_FIXED:
//   node generate_experiments.js

"use strict";
const fs = require("fs");
const path = require("path");

function range(lo, hi, step) {
  const values = [];
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i++) values.push(Math.round((lo + i * step) * 1e8) / 1e8);
  return values;
}

// Default sampling: every 0.05 from 0 to 1 (21 points), applied uniformly
// unless a parameter has a specific, checked reason to differ (see below).
const STANDARD_RANGE = range(0, 1, 0.05);

// Recalibrated after engine.js added entrant renewal (turnover replacements start as
// near-zero novices, not population clones — see spec.html "Entrant renewal"). That
// changed the dynamics enough that every range below was re-checked empirically
// against the new mechanism, not carried over from before.
// Key order here is what numbers experiment.1..15 (see the pairing loop below) —
// kept stable across the entrant-renewal recalibration on purpose, so experiment.N
// still means the same pair it always has. Change it only if you're fine with every
// experiment file's number shifting.
const STUDY_PARAMS = {
  // Exception: turnoverRate is a population-replacement FRACTION PER TICK. Checked
  // empirically against the new mechanism — with novices constantly diluting
  // institution averages, even a healthy no-AI system can't keep up past
  // turnoverRate ~ 0.02; both arms collapse to the same floor for the rest of the
  // way to 1. (This zone shrank further than before — it was [0,0.2] under the old
  // mechanism, now it's [0,0.02] — turnover matters much more once entrants have to
  // actually earn their way up instead of arriving pre-skilled.)
  turnoverRate: { values: range(0, 0.02, 0.001), default: 0.01 },
  learningRateSpread: { values: STANDARD_RANGE, default: 0.4 },
  // transferRate needs its default far higher than you'd guess (was 0.02) — see
  // "Entrant renewal" in spec.html. Below roughly 0.3, even the no-AI baseline can't
  // onboard novices faster than turnover dilutes institutions, so both arms collapse
  // for reasons that have nothing to do with AI. The full [0,1] sweep still shows
  // real variation throughout (checked), so the range itself didn't need to change,
  // only the default — this is the one to look at for the clearest baseline-vs-AI
  // contrast.
  transferRate: { values: STANDARD_RANGE, default: 0.5 },
  // Exception: decayRate has the same shape of problem as turnoverRate now, for a
  // related reason — checked empirically, the baseline/treatment split happens
  // within [0, 0.05]; by 0.05 the no-AI arm has already collapsed too (shareExpert
  // 97%->0% across just that span), so the rest of [0,1] is a flat, uninteresting
  // double-floor.
  decayRate: { values: range(0, 0.05, 0.0025), default: 0.01 },
  // Exception, and an important one: [0,1] silently assumed AI can only ever dampen
  // learning, never help it. But >1 is a real, documented regime (AI *amplifying*
  // transfer instead of substituting for it), and it's not just theoretical —
  // checked empirically, meanE_shortfall flips negative (treatment beats baseline)
  // starting around aiDampeningBelow~1.2. Capping the sweep at 1 made "AI always
  // hurts" a guaranteed property of the range, not a finding. Extended to [0,2]
  // (the engine's own supported range) at a coarser 0.1 step, same 21 points as
  // every other axis, so this costs nothing extra to run.
  // default (the value used whenever this one ISN'T the swept axis) is 1.0 = fully
  // neutral, no dampening at all — displays as 0 on the -1..+1 scale. Was 0.0 (max
  // dampening) per an earlier steer, but that turned out to swamp every non-dampening
  // experiment (see the file-header comment above for the empirical check) — moved to
  // neutral, per a later steer, specifically so the other nine parameters are studied
  // against an unbiased AI backdrop rather than one that's already at its floor.
  aiDampeningBelow: { values: range(0, 2, 0.1), default: 1.0 },
  aiDampeningAbove: { values: range(0, 2, 0.1), default: 1.0 },

  // The five below were added after the original six, appended (not interleaved) so
  // experiment.1..15 keep meaning exactly what they always have — only experiment.16
  // onward are new. Each range/default was checked empirically against the current
  // entrant-renewal + fixed-median-ai_level mechanism before being set, same bar as
  // the original six.
  //
  // Checked: with aiDampeningBelow/Above both at their 0.0 fixed default (the
  // worst-case-AI backdrop every non-dampening param is studied against), meanE moves
  // only ~0.72->0.75 across the full [0,5] range — real, monotonic, but compressed,
  // because near-total dampening already dominates the outcome regardless of atrophy
  // speed. [1,5] is aiAtrophyMultiplier's original documented "always accelerates"
  // range (see simulator.html's slider and spec.html); extended down to 0 to also
  // cover the reverse regime (multiplier <1 slows decay below its unassisted rate —
  // "AI use, but somehow protective of retention"), same reasoning as why
  // aiDampeningBelow/Above were extended past 1 into amplification territory.
  aiAtrophyMultiplier: { values: range(0, 5, 0.25), default: 1.5 },

  // Exception: aiLevelFraction (lambda) is a fraction of the t=0 population's single
  // GREATEST expert (state.startTopE in engine.js), not of 0..1 directly — per your
  // steer, swept from 1% to 100% of that benchmark rather than the STANDARD_RANGE
  // floor of exactly 0. At exactly 0, ai_level==0 and, since E is never negative,
  // literally nobody ever falls "below" it — a degenerate edge case that would make
  // aiDampeningBelow/aiAtrophyMultiplier structurally unable to apply to anyone at
  // that one grid point. 0.01 keeps the same 21-point resolution as every other axis
  // (only the first point moved, from 0.00 to 0.01) while avoiding that dead cell.
  //
  // Also worth knowing before reading any heatmap involving this axis: with
  // aiDampeningBelow == aiDampeningAbove (true whenever dampening isn't itself one of
  // the two swept axes — both now default to 1.0, neutral), which side of the
  // ai_level threshold a human falls on doesn't matter for LEARNING, since both sides
  // get the identical (neutral) multiplier. Re-checked after the dampening default
  // moved from 0.0 to 1.0: with aiAtrophyMultiplier ALSO neutral (1.0), this is a
  // perfect no-op (meanE flat to 4 decimal places across the full range). At
  // aiAtrophyMultiplier's actual default (1.5, not neutral), a small residual effect
  // survives via the DECAY branch instead — atrophy still only accelerates decay for
  // whoever falls "below," so where that line sits still matters a little (meanE
  // ranges ~0.81-0.82 through most of the sweep, dropping to ~0.77 as aiLevelFraction
  // approaches 1.0 and nearly the whole population falls "below"). Still far smaller
  // than this parameter's own two informative pairings against aiDampeningBelow and
  // aiDampeningAbove (~0.45 range when they actually differ from each other) — the
  // other eight are still expected to read as close to flat. Kept in anyway per your
  // steer (completeness over pruning), so the near-flatness is a documented finding,
  // not a gap.
  aiLevelFraction: { values: [0.01].concat(range(0.05, 1.0, 0.05)), default: 0.70 },

  // No exception needed — checked, meanE_shortfall rises smoothly and monotonically
  // across the full engine-supported range (0.58 at 0 up to 0.83 at 0.8), no dead or
  // saturated zone. Upper bound of 0.8 (not 1.0) matches simulator.html's own slider,
  // which caps here specifically to avoid the skew-normal distribution clipping
  // heavily against the 1.0 ceiling — checked, values above ~0.85 stop changing the
  // outcome meaningfully because the population's already saturated there.
  expertiseMean: { values: range(0, 0.8, 0.04), default: 0.28 },

  // Exception: this is the parameter the entrant-renewal mechanism exists to make
  // matter, and it shows — checked, shortfall runs from 0.77 at 0 (entrants join with
  // nothing) down to 0.03 at 1.0 (entrants join already fully skilled, so there's
  // nothing left for AI reliance to prevent them from learning). Capped the sweep at
  // 0.5, matching simulator.html's own slider bound, since beyond that "entrant" stops
  // meaning "novice" and the shortfall is already deep into its flattening tail
  // (checked: 0.36 at 0.5, most of the interesting motion already happened).
  entrantExpertiseMean: { values: range(0, 0.5, 0.025), default: 0.05 },

  // Exception: aiGain only scales the boost added to observed capability C — it never
  // touches real expertise E (checked directly in engine.js: C[i] = ... + aiGain *
  // boost(...), E[i] has no aiGain term at all). So it has zero effect on
  // meanE_shortfall/shareExpert_shortfall, the two original metrics. Confirmed real
  // and substantial on the metric that does capture it though: meanC-meanE gap runs
  // 0 -> 0.59 across aiGain's own [0,2] engine range as aiGain goes 0->2 — hence
  // meanC_shortfall was added to the report specifically so this axis has somewhere to
  // show up. [0,2] matches simulator.html's slider and the engine's own documented
  // range (0 = AI has no visible effect in any response mode).
  aiGain: { values: range(0, 2, 0.1), default: 1.0 },
};

// Everything NOT under study, pinned the same across every experiment.
const BASE_FIXED = {
  N: 2000, M: 100, graphAttachment: 2,
  expertiseSpread: 0.30, expertiseSkew: 3,
  entrantExpertiseSpread: 0.05, entrantExpertiseSkew: 0,
  mobilityMode: "hybrid", jumpProbability: 0.10,
  competitionAversion: 0.5, prestigeWeight: 0.3, baseMoveProb: 0.05,
  aiResponseMode: "floor",
  // Not AI-gated (applies identically in both arms of every experiment), and checked
  // to leave the AI/no-AI contrast essentially untouched at this rate — see engine.js's
  // DEFAULT_PARAMS comment and spec.html §11 for the calibration and the runaway
  // positive-feedback bug this specific formulation (fixed founding-average anchor,
  // not the live one) exists to avoid. Listed explicitly rather than left to the
  // engine default so it's visible here alongside everything else this experiment set
  // holds fixed.
  ambientGrowthRate: 0.001,
};

const REPLICATES = 5;
const HORIZON = 1000;
const RECORD_AT = range(25, HORIZON, 25); // 25, 50, 75, ..., 975, 1000 (40 checkpoints)
const SEED = 1;

const keys = Object.keys(STUDY_PARAMS);
// experiment.N numbering is generated in three phases, not by a single naive nested
// loop over `keys` — a plain i<j double loop would re-sort the new params into the
// MIDDLE of the sequence (turnoverRate would pair with every new param before
// learningRateSpread ever got a turn), silently renumbering all 15 original files.
// Phase 1 reproduces the original 15 in their original order; phases 2-3 are strictly
// new pairs, appended after.
const ORIGINAL_KEYS = [
  "turnoverRate", "learningRateSpread", "transferRate", "decayRate",
  "aiDampeningBelow", "aiDampeningAbove",
];
const NEW_KEYS = keys.filter((k) => !ORIGINAL_KEYS.includes(k));
const pairs = [];
for (let i = 0; i < ORIGINAL_KEYS.length; i++) {
  for (let j = i + 1; j < ORIGINAL_KEYS.length; j++) pairs.push([ORIGINAL_KEYS[i], ORIGINAL_KEYS[j]]);
}
for (const a of ORIGINAL_KEYS) {
  for (const b of NEW_KEYS) pairs.push([a, b]);
}
for (let i = 0; i < NEW_KEYS.length; i++) {
  for (let j = i + 1; j < NEW_KEYS.length; j++) pairs.push([NEW_KEYS[i], NEW_KEYS[j]]);
}

// experiments/ now holds the WORLD-MODEL set (generate_worldmodel_experiments.js).
// The BA set lives here so regenerating either one can never clobber the other.
fs.mkdirSync(path.join(__dirname, "experiments-ABGraph"), { recursive: true });

const manifest = [];
pairs.forEach(([a, b], idx) => {
  const n = idx + 1;
  const fixed = Object.assign({}, BASE_FIXED);
  keys.forEach((k) => { if (k !== a && k !== b) fixed[k] = STUDY_PARAMS[k].default; });

  const config = {
    mode: "grid",
    replicates: REPLICATES,
    horizon: HORIZON,
    recordAt: RECORD_AT,
    seed: SEED,
    pairWithBaseline: true,
    fixed,
    params: {
      [a]: { values: STUDY_PARAMS[a].values },
      [b]: { values: STUDY_PARAMS[b].values },
    },
  };

  const file = `experiments-ABGraph/experiment.${n}.json`;
  fs.writeFileSync(path.join(__dirname, file), JSON.stringify(config, null, 2) + "\n");
  manifest.push({ n, file, x: a, y: b, runs: STUDY_PARAMS[a].values.length * STUDY_PARAMS[b].values.length * REPLICATES * 2 });
});

fs.writeFileSync(
  path.join(__dirname, "experiments.manifest.json"),
  JSON.stringify({ studyParams: STUDY_PARAMS, baseFixed: BASE_FIXED, replicates: REPLICATES, horizon: HORIZON, recordAt: RECORD_AT, experiments: manifest }, null, 2) + "\n"
);

const totalRuns = manifest.reduce((s, m) => s + m.runs, 0);
// Two real measurements at this grid resolution, same machine, same --workers 8,
// four minutes apart: 2646 runs in 106s (40ms/run) and 4410 runs in 712s (161ms/run).
// That's a 4x spread with nothing else changed, so treat this as a rough bound, not
// a prediction — parallel throughput on this box doesn't seem to be reliable run to
// run (one measurement showed only ~200% CPU used despite 8 workers on an 18-core
// machine with no cgroup quota set, so something's throttling it beyond core count).
// Best move: run one experiment first (./run_experiments.sh 1) and time it, rather
// than trust this number for planning the full batch.
const MS_PER_RUN_LOW = 40, MS_PER_RUN_HIGH = 161;
const estLow = Math.round((totalRuns * MS_PER_RUN_LOW) / 1000);
const estHigh = Math.round((totalRuns * MS_PER_RUN_HIGH) / 1000);

console.log(`wrote ${pairs.length} BA experiment files (experiments-ABGraph/experiment.1.json .. experiment.${pairs.length}.json) + experiments.manifest.json`);
manifest.forEach((m) => console.log(`  ${m.file}: x=${m.x} y=${m.y} (${m.runs} runs)`));
console.log(`total runs across all experiments: ${totalRuns}`);
console.log(`rough range at ~8 workers, based on 2 measurements that disagreed 4x: ~${(estLow / 60).toFixed(0)}-${(estHigh / 60).toFixed(0)} min for the full ./run_experiments.sh`);
console.log(`recommended: run ./run_experiments.sh 1 first and time it — don't plan around this estimate`);
