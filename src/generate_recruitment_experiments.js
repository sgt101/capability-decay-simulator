// Generates data/experiments-recruitment/recruitment.1.json .. .4.json — the RECRUITMENT
// SHOCK set: what a hiring freeze does to a field that has already reached equilibrium,
// and how that interacts with AI.
//
//   node src/generate_recruitment_experiments.js
//
// THE MECHANISM. engine.js gained a recruitment freeze (see DEFAULT_PARAMS.
// recruitmentShockYears): for a window of years, only `recruitmentFraction` of
// retirements are refilled. Retirement and hiring used to be one atomic statement, so the
// population was conserved by construction and this could not be expressed at all.
//
// There is NO catch-up hiring. Outside the window every retirement is replaced one for
// one, which is both the original behaviour and the normal hiring rate, so vacancies
// accumulated during the freeze are never worked off: the headcount shortfall is
// permanent. That is deliberate — it keeps the two things a freeze does separable (it
// removes a cohort from the expertise ladder, and it shrinks the field) instead of
// letting a recovery rule mix them.
//
// TIMING. Configurable — see the flags below — because how long a field needs to reach
// equilibrium is a judgement call, not a fact this file should hardcode.
//
// The default is 3 careers (120 years): meanE and shareExpert reach their stationary band
// within about one career (40 years) and hold it flat for the remaining two, measured
// directly on this calibration at N=11322 (single seed; see the commit history for the
// numbers). systemCapability is noisier and has a slower initial ramp — driven by the
// tenure structure feeding teachTopN, not by mean expertise — that visibly levels out by
// roughly year 100. 120 years sits just past that, not deep inside a comfortable margin,
// which is worth knowing if a result near the shipped default looks marginal: raising
// --shock-start-years costs nothing but simulation time.
//
// Starting the freeze before the field has settled would measure it against a population
// still moving on its own, and the two effects would not be separable. --aftermath-years
// sets how long to watch afterward, independent of where the freeze itself falls.
//
// WHICH METRIC TO READ. Not meanE. A freeze removes ENTRANTS, who are the least expert
// people in the field, so mean expertise per surviving person barely moves and can even
// rise. The damage is in the absolute total: systemCapability is a sum over people, and
// activeFraction reports how much of the establishment is still staffed. Read those two
// together — capability falling no faster than headcount is a smaller field doing
// proportionally the same work; capability falling faster is a field that has also lost
// its ladder.
//
// GRID STRUCTURE. Duration x depth x three AI parameters is five dimensions and is not
// runnable. Instead: one experiment characterises the shock itself over duration x depth,
// and three cross the shock DEPTH (at a fixed five-year freeze, itself adjustable) with
// each AI dial in turn.
//
// Usage:
//   node src/generate_recruitment_experiments.js
//   node src/generate_recruitment_experiments.js --replicates 32
//   node src/generate_recruitment_experiments.js --shock-start-years 120
//   node src/generate_recruitment_experiments.js --shock-start-years 200 --aftermath-years 100 --fixed-duration-years 5
"use strict";
const fs = require("fs");
const path = require("path");
const { EXPERT_THRESHOLD, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS, WORLD_MODEL_PARAMS,
        TICKS_PER_YEAR, CAREER_YEARS, FIELD_DIVISOR } = require("./engine.js");
const { loadWorldModel, suggestedN } = require("./world_model.js");
const paths = require("./paths.js");

const OUT_DIR = paths.data("experiments-recruitment");

function argNum(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  if (!Number.isFinite(v) || v <= 0) {
    console.error(`[gen-recruitment] ${flag} needs a positive number, got "${process.argv[i + 1]}"`);
    process.exit(1);
  }
  return v;
}

// 3 careers by default — see the TIMING note above for the measurement behind that choice
// and its margin. All three are years; converted to ticks below once TICKS_PER_YEAR is in
// scope from CAREER_YEARS-derived arithmetic.
const SHOCK_START_YEARS = argNum("--shock-start-years", 3 * CAREER_YEARS);
const AFTERMATH_YEARS = argNum("--aftermath-years", 100);
const FIXED_SHOCK_YEARS = argNum("--fixed-duration-years", 5); // the freeze length the AI pairings hold
// Raised from 3: this set's baseline/treatment arms diverge in their random-number
// stream once the freeze changes how many draws a tick consumes (see the note beside
// hireProb in engine.js), so replicate noise here is higher than in a set where the arms
// differ only by a multiplier. 3 replicates were not enough to separate a real effect
// from that noise cleanly; 32 buys a ~3.3x narrower standard error at 10.7x the run count.
const REPLICATES = argNum("--replicates", 32);

const SHOCK_START = Math.round(SHOCK_START_YEARS * TICKS_PER_YEAR);
const HORIZON = SHOCK_START + Math.round(AFTERMATH_YEARS * TICKS_PER_YEAR);
const SEED = 1;
const AI_GRID = 11;                          // AI axes; 10 shock steps x 11 = 110 cells

// Yearly, as everywhere else in this repository.
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

// The freeze DEPTH axis is stated as the reduction in hiring, 10% to 100%, because that
// is how the question is asked. The engine parameter is the complement — the share of
// retirements still refilled — so the values are 1 - reduction, descending.
const REDUCTIONS = linspace(0.1, 1.0, 10);
const FRACTIONS = REDUCTIONS.map((r) => +(1 - r).toFixed(6));

const BASE_FIXED = Object.assign({
  graphSource: "worldModel",
  institutionSizing: "weighted",
  expertiseMean: 0.28,
  expertiseSpread: 0.30,
  expertiseSkew: 3,
  entrantExpertiseMean: 0.05,
  entrantExpertiseSpread: 0.05,
  entrantExpertiseFloor: 0.05,
  mobilityMode: "hybrid",
  jumpProbability: 0.10,
  competitionAversion: 0.5,
  prestigeWeight: 0.3,
  aiDampeningAbove: 1.0,
  aiDampeningBelow: 0.75,
  aiLevelFraction: EXPERT_THRESHOLD,
  recruitmentShockStart: SHOCK_START,
}, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS, WORLD_MODEL_PARAMS, { N: INTAKE_DERIVED_N });

const WORLD_MODEL = {
  worldModelPath: "world-model.json",
  mobilityCostsPath: "mobility-costs.json",
  worldModelOptions: {
    useBlocAffinity: true, hubSource: "located_in", prestigeFrom: "intake",
    zeroIntakePolicy: "floor1", useExplicitEdges: true,
  },
};

// Experiment NUMBERS are stable identities: results/recruitment.N/ holds finished CSVs
// and the report indexes them by number, so a number must always mean the same pairing.
// Append here; never insert or reorder.
const EXPERIMENTS = [
  {
    n: 1,
    title: "freeze duration x freeze depth",
    note: "The shock on its own, against a world with neither AI nor freeze. Both axes are "
      + "swept, so the baseline is one fixed reference for the whole grid rather than a "
      + "per-cell twin.",
    params: {
      recruitmentShockYears: { values: linspace(1, 10, 10) },
      recruitmentFraction: { values: FRACTIONS },
    },
  },
  {
    n: 2,
    title: "freeze depth x aiDampeningAbove",
    note: `Freeze fixed at ${FIXED_SHOCK_YEARS} years. Gamma_above acts on people already `
      + "at their institution's teaching level, i.e. the seniors a thinned field leans on.",
    fixed: { recruitmentShockYears: FIXED_SHOCK_YEARS },
    params: {
      recruitmentFraction: { values: FRACTIONS },
      aiDampeningAbove: { values: linspace(0, 2, AI_GRID) },
    },
  },
  {
    n: 3,
    title: "freeze depth x aiDampeningBelow",
    note: `Freeze fixed at ${FIXED_SHOCK_YEARS} years. The central pairing: gamma_below is `
      + "the channel AI crowds out entrant learning through, and a freeze removes entrants "
      + "outright, so the two act on the same population from opposite directions.",
    fixed: { recruitmentShockYears: FIXED_SHOCK_YEARS },
    params: {
      recruitmentFraction: { values: FRACTIONS },
      aiDampeningBelow: { values: linspace(0, 2, AI_GRID) },
    },
  },
  {
    n: 4,
    title: "freeze depth x aiLevelFraction",
    note: `Freeze fixed at ${FIXED_SHOCK_YEARS} years. Lambda sets how much of the field `
      + "counts as below the AI; a freeze changes the shape of the field, so it changes who "
      + "that is.",
    fixed: { recruitmentShockYears: FIXED_SHOCK_YEARS },
    params: {
      recruitmentFraction: { values: FRACTIONS },
      aiLevelFraction: { values: linspace(0.01, 1, AI_GRID) },
    },
  },
];

fs.mkdirSync(OUT_DIR, { recursive: true });
const manifest = { set: "recruitment", replicates: REPLICATES, horizon: HORIZON, seed: SEED,
  shockStart: SHOCK_START, experiments: [] };

EXPERIMENTS.forEach((e) => {
  const axes = Object.keys(e.params);
  const cfg = {
    mode: "grid",
    replicates: REPLICATES,
    horizon: HORIZON,
    recordAt: RECORD_AT,
    seed: SEED,
    pairWithBaseline: true,
    // THE REFERENCE IS A HEALTHY WORLD: no AI and no freeze. Without this the baseline arm
    // carries the same freeze as the treatment, so the paired columns answer "what did AI
    // add on top of the freeze" and nothing in the set answers "what did the two of them
    // cost together" -- which is the question a recruitment shock is run to ask.
    //
    // Switching the freeze off in the baseline is enough on its own: recruitmentFraction
    // is inert when recruitmentShockYears is 0, so a single override covers both axes.
    baselineParams: { recruitmentShockYears: 0 },
    worldModel: WORLD_MODEL,
    fixed: Object.assign({}, BASE_FIXED, e.fixed || {}),
    params: e.params,
  };
  // A study axis must not also be pinned, or the pin silently wins and the sweep is a
  // column of identical cells. Cheap to check and invisible when it goes wrong.
  axes.forEach((a) => {
    if (Object.prototype.hasOwnProperty.call(cfg.fixed, a)) delete cfg.fixed[a];
  });
  const file = path.join(OUT_DIR, `recruitment.${e.n}.json`);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  const cells = axes.reduce((s2, a) => s2 * e.params[a].values.length, 1);
  manifest.experiments.push({ n: e.n, title: e.title, note: e.note, x: axes[0], y: axes[1],
    cells, runs: cells * REPLICATES * 2 });
  console.log(`recruitment.${e.n}.json  ${e.title}  — ${cells} cells, ${cells * REPLICATES * 2} runs`);
});

// studyParams carries a `default` per axis as well as its values: build_report.js shows
// the pinned value of every study parameter an experiment does NOT sweep, and reads it
// from here. Without it the report's fixed-parameter panel renders "undefined".
manifest.studyParams = {
  recruitmentShockYears: { label: "freeze duration (years)", values: linspace(1, 10, 10), default: FIXED_SHOCK_YEARS },
  recruitmentFraction: { label: "share of hiring retained", values: FRACTIONS, default: 1 },
  aiDampeningAbove: { label: "gamma_above", values: linspace(0, 2, AI_GRID), default: BASE_FIXED.aiDampeningAbove },
  aiDampeningBelow: { label: "gamma_below", values: linspace(0, 2, AI_GRID), default: BASE_FIXED.aiDampeningBelow },
  aiLevelFraction: { label: "lambda", values: linspace(0.01, 1, AI_GRID), default: BASE_FIXED.aiLevelFraction },
};
// Everything held constant across the set. build_report.js seeds each experiment's
// fixed-parameter panel from this; omitting it was why the recruitment report showed
// "undefined" where the other sets show N and the calibration values.
//
// M is deliberately absent and cannot be added: with graphSource "worldModel" the
// institution count is derived from the world model and setting it in a config throws.
// build_report.js backfills it from the results instead.
// A separate notes page rather than a block printed above the grid — see
// build_entrant_report.js / generate_entrant_experiments.js for the same pattern. Method
// notes belong beside the numbers, not repeated above the figure on every load. Written
// here, from the same constants the configs are built from, so the timings and ranges it
// states cannot drift from the runs they describe.
const SHOCK_YEAR = SHOCK_START / TICKS_PER_YEAR;
const FREEZE_END_FIXED = SHOCK_START + FIXED_SHOCK_YEARS * TICKS_PER_YEAR;
manifest.notesPage = {
  file: "recruitment_notes.html",
  title: "Recruitment shock set: definitions and method",
  html: `
  <h2>Scope</h2>
  <p>The set applies a temporary reduction in hiring to a field that has already reached
  its equilibrium distribution, crossed with freeze duration, freeze depth, and each of
  the three AI parameters in turn.</p>

  <h2>Timing</h2>
  <p>Horizon ${HORIZON} ticks (one tick is one month), so ${HORIZON / TICKS_PER_YEAR}
  years. The freeze is applied at t = ${SHOCK_START} (year ${SHOCK_YEAR} = ${SHOCK_YEAR / CAREER_YEARS}
  careers at the ${CAREER_YEARS}-year career length used throughout), not at t = 0: mean
  expertise and expert share reach their stationary band within about one career and hold
  it flat afterward on this calibration; system capability has a slower initial ramp,
  driven by the tenure structure rather than by mean expertise, that levels out by roughly
  year 100. An earlier freeze risks measuring the shock against a population still moving
  on its own rather than against an equilibrium; both the start (<code>--shock-start-years</code>)
  and the aftermath length (<code>--aftermath-years</code>) are flags to the generator, not
  fixed choices baked into this text. In the pairings that fix duration at
  ${FIXED_SHOCK_YEARS} years, the freeze runs from month ${SHOCK_START + 1} to month
  ${FREEZE_END_FIXED} (year ${SHOCK_YEAR + FIXED_SHOCK_YEARS}). Where duration is itself an
  axis, the freeze runs from month ${SHOCK_START + 1} for 12Y months.
  ${(HORIZON - SHOCK_START) / TICKS_PER_YEAR} years remain after the freeze ends in every
  case.</p>

  <h2>Mechanism</h2>
  <p>For the duration of the freeze, a fraction of retirements are refilled and the
  remainder leave the post vacant; that fraction is <code>recruitmentFraction</code>, shown
  in the report as hiring retained. 0 is a total freeze; 1 is normal hiring. The axis is
  therefore ordered from most severe (0) to least (1), the reverse of a severity axis.</p>
  <p>There is no catch-up hiring. After the freeze, retirements are refilled at the normal
  rate, which does not exceed replacement, so vacancies opened during the freeze are not
  recovered and the headcount reduction is permanent for the remainder of the run. This
  keeps two effects separable: removal of a cohort from the expertise ladder, and reduction
  in field size.</p>

  <h2>Baseline</h2>
  <p>Unlike the other sets, in which the baseline arm differs from the treatment arm only
  in <code>aiEnabled</code>, this baseline also sets <code>recruitmentShockYears = 0</code>
  (<code>baselineParams</code>). The baseline is therefore a field with neither AI nor the
  freeze. Change panels report the combined effect of both; level panels are read from the
  treatment arm, since the baseline's headcount is 1.0 by construction and carries no
  information about the freeze.</p>

  <h2>Design</h2>
  <p>${manifest.experiments.length} experiments. The first varies freeze duration
  (${linspace(1, 10, 10)[0]} to ${linspace(1, 10, 10)[9]} years) against freeze depth. The
  remaining three fix duration at ${FIXED_SHOCK_YEARS} years and vary depth against
  <code>aiDampeningAbove</code>, <code>aiDampeningBelow</code>, and
  <code>aiLevelFraction</code> respectively. Each is a grid at ${REPLICATES} replicates.
  Total ${manifest.experiments.reduce((s, e) => s + e.runs, 0).toLocaleString()} runs.</p>

  <h2>Metrics</h2>
  <p>Mean expertise is not the primary metric for this set. The freeze removes entrants,
  who are the lowest-expertise members of the field, so mean expertise among the remaining
  population can be stable or increase while the field is losing headcount. Headcount
  retained and capability per head are reported together to distinguish two outcomes: a
  smaller field with unchanged per-head capability, against a field that has also lost
  teaching capacity. A ratio of 1.0 on capability-per-head indicates the former; a ratio
  below 1.0 indicates the latter.</p>
  <p>Values are taken at the tick selected above, averaged over ${REPLICATES} replicates.
  Baseline and treatment arms of a replicate share a seed. The two arms diverge in their
  random draw sequence once the freeze changes how many draws a tick consumes, so
  replicate variance in this set is higher than in a set where the arms differ only by a
  multiplier. Population statistics are computed over staffed posts; a vacant post is
  excluded, not counted as zero expertise.</p>
`,
};
// Marks the freeze window on the trajectory panels. The start is the same tick in every
// pairing, so it is given directly. The end is not: pairings 2-4 fix duration at
// FIXED_SHOCK_YEARS, so it is a constant there too, but pairing 1 sweeps duration itself
// (recruitmentShockYears), so the end tick differs by trajectory panel. `param`/`base`/
// `scale` let report.template.html resolve it per panel — from the axis value the panel
// is fixed at when the parameter is the fixed axis, from exp.fixed when it is pinned, and
// (unresolvable, so the mark is skipped for that panel) when the parameter is itself the
// one varying across the panel's lines.
manifest.markTicks = [
  { tick: SHOCK_START, label: "freeze starts" },
  { label: "freeze ends", param: "recruitmentShockYears", base: SHOCK_START, scale: TICKS_PER_YEAR },
];
manifest.baseFixed = BASE_FIXED;
manifest.recordAt = RECORD_AT;
manifest.worldModel = WORLD_MODEL;
manifest.ticksPerYear = TICKS_PER_YEAR;
manifest.careerYears = CAREER_YEARS;
manifest.graphSource = "worldModel";
fs.writeFileSync(paths.data("experiments.recruitment.manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\nwrote ${path.relative(paths.ROOT, OUT_DIR)}/ and data/experiments.recruitment.manifest.json`);
console.log(`shock at t=${SHOCK_START} (year ${SHOCK_START / TICKS_PER_YEAR}), horizon ${HORIZON}`
  + ` (year ${HORIZON / TICKS_PER_YEAR}), N=${INTAKE_DERIVED_N}`);
console.log(`total: ${manifest.experiments.reduce((s2, e) => s2 + e.runs, 0)} runs`);
