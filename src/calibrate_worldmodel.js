// Calibration at the DEPLOYMENT configuration: the world model, N=10500, monthly tick.
//
// Sister to calibrate_pipeline.js, which fitted (learningCap, decayRate) at N=2000 on the
// generated BA graph. That was the right scale for the mechanism it was fitting, but it is
// not the configuration this model is used in. Below N=10500 the population per institution
// stops matching the world model's own distribution — 245 institutions and 2,000 people puts
// the median institution at 5 members, which is not a department — so the numbers fitted
// there do not describe the field anyone actually runs.
//
// What changed and why a re-fit is needed:
//   teachTopN     an absolute-count teaching pool, so institution SIZE buys teaching
//                 quality. A percentile pool is scale-free and cannot do that.
//   baseMoveProb  0.01 rather than 0.05 — a move every ~7 years rather than every 20
//                 months, which is a plausible career.
//
// teachTopN shrinks the teacher pool and makes it homogeneous, which REMOVES individual
// spread: the variance in who you draw as a teacher was one of the three mechanisms
// producing a ladder. It buys spread between institutions with spread between people. This
// scan puts the individual spread back through aptitudeSpread, which is the lever that acts
// on people directly rather than through teachers.
//
//   node src/calibrate_worldmodel.js              # the 2-D scan (background it, ~15 min)
//   node src/calibrate_worldmodel.js --verify     # one cell at full horizon and 2 seeds
//                                             # (env: CAP, APT)
//
// A cell is accepted only if it satisfies ALL FOUR:
//   1. time to expert   6-10 years, against the project's stated assumption of 8
//   2. ladder           IQR >= MIN_IQR, the individual spread the re-fit exists to restore
//   3. below expert     30-45%, so the threshold discriminates in both directions
//   4. stationary       |drift| <= MAX_DRIFT measured over a LONG window
//
// (4) is long deliberately. An earlier mechanism (criticalMass at low mobility) held level
// for 750 years and then collapsed to zero. A 250-year check passed it. Anything fitted here
// is going to be distributed, so the drift window has to outlast that failure mode.
"use strict";
const fs = require("fs");
const path = require("path");
const { initSim, tick, EXPERT_THRESHOLD, TICKS_PER_YEAR, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS } = require("./engine.js");
const { loadWorldModel } = require("./world_model.js");
const paths = require("./paths.js");

const N = 10500;
// Overridable so the fallback (teachTopN 8, which costs almost no individual spread to
// begin with) can be scanned without editing this file. Guarded: a non-numeric value
// here would silently switch a mechanism off and the scan would report a different
// model than the one it names in its header.
const num = (name, dflt) => {
  const v = process.env[name] === undefined ? dflt : parseFloat(process.env[name]);
  if (!Number.isFinite(v)) throw new Error(`${name} is not a number (${process.env[name]})`);
  return v;
};
// learningRateSpread lives in DEFAULT_PARAMS, not PIPELINE_PARAMS, so --verify needs a
// fallback for it when no APT is given.
const DEFAULT_AXIS2 = 0.4;
const MOVE_PROB = num("MOVE_PROB", 0.01);
const TEACH_TOP_N = num("TOPN", 16);

// Which parameter the second axis varies. aptitudeSpread widens the distribution from
// BELOW — wider ceilings add people who never reach expert — so it buys IQR at the cost
// of the below-expert share, and it dilutes the between-institution signal because the
// variance it adds is within institutions. learningRateSpread instead smears people
// along the CLIMB: slow learners still arrive, just later. Worth scanning both before
// concluding that individual spread and institutional spread cannot be had together.
const AXIS2 = process.env.AXIS2 || "aptitudeSpread";
if (!["aptitudeSpread", "learningRateSpread"].includes(AXIS2)) {
  throw new Error(`AXIS2 must be aptitudeSpread or learningRateSpread (got ${AXIS2})`);
}

const SCAN_HORIZON = 6000, SCAN_DRIFT_FROM = 2000;   // 500y, screening
const FULL_HORIZON = 12000, FULL_DRIFT_FROM = 2000;  // 1000y, the finalists
const BORN_FROM = 600, BORN_TO = 4000;               // window for timing entrants

const TARGET_YEARS = 8, YEARS_LO = 6, YEARS_HI = 10;
const MIN_IQR = 0.27;          // the ladder as calibrated before teachTopN narrowed it
const BELOW_LO = 0.30, BELOW_HI = 0.45;
const MAX_DRIFT = 0.020;

const pct = (a, q) => { const v = [...a].sort((x, y) => x - y); return v[Math.floor(q * (v.length - 1))]; };
const corr = (a, b) => {
  const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length;
  let sa = 0, sb = 0, sab = 0;
  for (let i = 0; i < a.length; i++) { sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; sab += (a[i] - ma) * (b[i] - mb); }
  return sa && sb ? sab / Math.sqrt(sa * sb) : NaN;
};

const worldFiles = () => [
  JSON.parse(fs.readFileSync(paths.data("world-model.json"), "utf8")),
  JSON.parse(fs.readFileSync(paths.data("mobility-costs.json"), "utf8")),
];

function once(extra, seed, horizon, driftFrom) {
  const [world, costs] = worldFiles();
  const g = loadWorldModel(world, costs);
  const s = initSim(Object.assign({ N, M: g.M, seed, baseMoveProb: MOVE_PROB },
    MONTHLY_TICK_PARAMS, PIPELINE_PARAMS,
    { graph: g, teachTopN: TEACH_TOP_N }, extra));

  // Preallocated, not Array.from per tick: at N=10500 over 12,000 ticks that allocation
  // dominates the run and turns a 45-second cell into several minutes.
  const prev = new Float32Array(N);
  const born = new Map(), times = [];
  let atDrift = 0, atEnd = 0;
  for (let t = 1; t <= horizon; t++) {
    const timing = t >= BORN_FROM && t <= BORN_TO;
    if (timing) prev.set(s.E);
    const m = tick(s);
    if (t === driftFrom) atDrift = m.meanE;
    if (t === horizon) atEnd = m.meanE;
    if (timing) {
      for (let i = 0; i < N; i++) {
        if (s.E[i] < 0.10 && prev[i] > 0.15) born.set(i, t);
        else if (born.has(i) && s.E[i] >= EXPERT_THRESHOLD) { times.push(t - born.get(i)); born.delete(i); }
      }
    }
  }
  times.sort((a, b) => a - b);

  const E = Array.from(s.E), M = s.params.M;
  const size = new Array(M).fill(0), sum = new Array(M).fill(0);
  for (let i = 0; i < N; i++) { size[s.inst[i]]++; sum[s.inst[i]] += E[i]; }
  const live = [...Array(M).keys()].filter((j) => size[j] >= 5);
  const ibar = live.map((j) => sum[j] / size[j]), sz = live.map((j) => size[j]);

  return {
    years: times.length ? times[times.length >> 1] / TICKS_PER_YEAR : Infinity,
    mean: E.reduce((a, b) => a + b, 0) / N,
    iqr: pct(E, 0.75) - pct(E, 0.25),
    p10: pct(E, 0.10), p50: pct(E, 0.50), p90: pct(E, 0.90),
    below: E.filter((e) => e < EXPERT_THRESHOLD).length / N,
    iSpread: pct(ibar, 0.90) - pct(ibar, 0.10),
    corrSize: corr(sz, ibar),
    drift: atEnd - atDrift,
  };
}

function evaluate(extra, seeds, horizon, driftFrom) {
  const runs = seeds.map((seed) => once(extra, seed, horizon, driftFrom));
  const av = (k) => runs.reduce((a, r) => a + r[k], 0) / runs.length;
  return Object.fromEntries(Object.keys(runs[0]).map((k) => [k, av(k)]));
}

function verdict(r) {
  if (!isFinite(r.years)) return "never";
  if (r.years < YEARS_LO || r.years > YEARS_HI) return "timing";
  if (Math.abs(r.drift) > MAX_DRIFT) return "DRIFTS";
  if (r.below < BELOW_LO || r.below > BELOW_HI) return "level";
  if (r.iqr < MIN_IQR) return "flat";
  return "USABLE";
}

if (process.argv.includes("--verify")) {
  const cap = parseFloat(process.env.CAP || String(PIPELINE_PARAMS.learningCap));
  const apt = parseFloat(process.env.APT || String(PIPELINE_PARAMS[AXIS2] ?? DEFAULT_AXIS2));
  for (const [n, v] of [["CAP", cap], ["APT", apt]]) {
    if (!Number.isFinite(v)) throw new Error(`${n} is not a number (${v}) — a non-numeric value here silently switches a mechanism off`);
  }
  console.log(`verify  learningCap=${cap} ${AXIS2}=${apt}`);
  console.log(`  world model, N=${N}, baseMoveProb=${MOVE_PROB}, teachTopN=${TEACH_TOP_N}`);
  console.log(`  ${FULL_HORIZON / TICKS_PER_YEAR} years, 2 seeds\n`);
  const r = evaluate({ learningCap: cap, [AXIS2]: apt }, [1, 2], FULL_HORIZON, FULL_DRIFT_FROM);
  console.log("  median years to expert  ", r.years.toFixed(1), `(target ${TARGET_YEARS})`);
  console.log("  meanE                   ", r.mean.toFixed(4));
  console.log("  p10 / p50 / p90         ", r.p10.toFixed(3), r.p50.toFixed(3), r.p90.toFixed(3));
  console.log("  interquartile range     ", r.iqr.toFixed(3), `(need >= ${MIN_IQR})`);
  console.log("  share below expert      ", (r.below * 100).toFixed(1) + "%");
  console.log("  institutional spread    ", r.iSpread.toFixed(3));
  console.log("  corr(size, institution E)", r.corrSize.toFixed(3));
  console.log("  drift over", FULL_HORIZON - FULL_DRIFT_FROM, "ticks ",
    (r.drift >= 0 ? "+" : "") + r.drift.toFixed(4), Math.abs(r.drift) <= MAX_DRIFT ? "(stationary)" : "(DRIFTS)");
  console.log("  verdict                 ", verdict(r));
  process.exit(0);
}

const list = (name, dflt) => {
  if (process.env[name] === undefined) return dflt;
  const v = process.env[name].split(",").map((x) => parseFloat(x.trim()));
  if (!v.length || v.some((x) => !Number.isFinite(x))) throw new Error(`${name} is not a comma-separated number list (${process.env[name]})`);
  return v;
};
const CAPS = list("CAPS", [0.0048, 0.0056, 0.0065, 0.0075]);
const SPREADS = list("SPREADS", [0.20, 0.24, 0.28, 0.32]);

console.log("World-model calibration — learningCap x " + AXIS2);
console.log(`  N=${N}, 245 institutions, baseMoveProb=${MOVE_PROB}, teachTopN=${TEACH_TOP_N}`);
console.log(`  screening at ${SCAN_HORIZON / TICKS_PER_YEAR}y, 1 seed; finalists re-run at ${FULL_HORIZON / TICKS_PER_YEAR}y with --verify`);
console.log(`  accept: ${YEARS_LO}-${YEARS_HI}y to expert, IQR >= ${MIN_IQR}, ${BELOW_LO * 100}-${BELOW_HI * 100}% below expert, |drift| <= ${MAX_DRIFT}`);
console.log("  cells show: years / IQR / %below / verdict\n");
console.log("  " + ("cap\\" + AXIS2.replace("Spread", "")).padEnd(11) + SPREADS.map((s) => String(s).padStart(24)).join(""));

const results = [];
for (const cap of CAPS) {
  let row = "  " + String(cap).padEnd(11);
  for (const apt of SPREADS) {
    const r = evaluate({ learningCap: cap, [AXIS2]: apt }, [1], SCAN_HORIZON, SCAN_DRIFT_FROM);
    const v = verdict(r);
    results.push({ cap, apt, ...r, verdict: v });
    const yrs = isFinite(r.years) ? r.years.toFixed(1) + "y" : "never";
    row += `${yrs}/${r.iqr.toFixed(3)}/${(r.below * 100).toFixed(0)}%/${v}`.padStart(24);
  }
  console.log(row);
}

const usable = results.filter((r) => r.verdict === "USABLE");
console.log(`\n${usable.length} usable cell(s).\n`);
if (usable.length) {
  // Rank on the point of the exercise: keep the ladder, hit the timing, and preserve as
  // much of the institutional signal teachTopN was adopted for as possible.
  usable.sort((a, b) => (Math.abs(a.years - TARGET_YEARS) / 4 - a.corrSize - a.iqr) -
                        (Math.abs(b.years - TARGET_YEARS) / 4 - b.corrSize - b.iqr));
  console.log("  cap     spread   years    IQR   below   instSpread  corrSize   drift");
  for (const r of usable.slice(0, 6)) {
    console.log("  " + String(r.cap).padEnd(8) + String(r.apt).padEnd(8) +
      (r.years.toFixed(1) + "y").padStart(6) + r.iqr.toFixed(3).padStart(7) +
      ((r.below * 100).toFixed(0) + "%").padStart(8) + r.iSpread.toFixed(3).padStart(12) +
      r.corrSize.toFixed(3).padStart(10) + ((r.drift >= 0 ? "+" : "") + r.drift.toFixed(4)).padStart(9));
  }
  const best = usable[0];
  console.log(`\nrecommended: learningCap=${best.cap}, ${AXIS2}=${best.apt}`);
  console.log(`  confirm at full horizon:  CAP=${best.cap} APT=${best.apt} node calibrate_worldmodel.js --verify`);
} else {
  console.log("Widen the grid, or relax a criterion — but say which one, and why, in the commit.");
}
