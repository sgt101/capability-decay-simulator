// Calibration for the ENTRANT PIPELINE (engine.js: learningCap + seniorTenureYears).
//
// SCALE: this scan runs at N=2000, M=40 on the GENERATED BA GRAPH. That was the right
// scale for the mechanism it fits, but it is not the configuration the model is used in.
// For the deployment configuration — the world model at N=10500, where the population per
// institution matches the world model's own size distribution — use
// calibrate_worldmodel.js, which re-fits learningCap against learningRateSpread with the
// teaching rule (teachTopN) and mobility that configuration uses.
//
// Sister to calibrate_time_base.js, which fitted (transferRate, decayRate) for a
// stationary baseline. That scan measured time-to-expert but did not bind on it, and
// the set it chose reaches expert in a median of 1.8 years against this project's own
// stated assumption of 8 (TARGET_YEARS_TO_EXPERT there). The reason is structural:
// gap-proportional learning is exponential, so an entrant covers most of the distance
// immediately and then crawls. The pipeline occupied ~4% of a career, which is why ~4%
// of the population was ever below the expert threshold and the rest sat in a blob
// 0.025 wide.
//
//   node src/calibrate_pipeline.js              # the scan
//   node src/calibrate_pipeline.js --verify     # one cell, with the distribution it gives
//                                           # (env: CAP, DR, TEN)
//
// A cell is accepted only if it satisfies ALL THREE:
//   1. time to expert  — median 6-10 years for an entrant, against a target of 8
//   2. stationary      — |meanE(HORIZON) - meanE(DRIFT_FROM)| <= MAX_DRIFT, so the
//                        AI contrast is read against a level baseline
//   3. populated ladder — a real spread of expertise, not a point mass: at least
//                        MIN_BELOW of the population below the expert threshold and
//                        an interdecile range of at least MIN_SPREAD
//
// (3) is the point of the exercise, and it is what the previous calibration could not
// deliver at any (transferRate, decayRate) — the distribution's attractor is the
// institution's own mean, so it compresses to a point regardless of the rates.
"use strict";
const { initSim, tick, EXPERT_THRESHOLD, TICKS_PER_YEAR, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS } = require("./engine.js");

const N = 2000, M = 40, SEEDS = [1, 2, 3];
const BURN_IN = 600;        // let the initial transient pass before measuring anything
// The pipeline's transient runs for SEVERAL CAREERS, not the few years the old model
// took: the population has to reach a stationary tenure structure, and everyone
// currently in the field has to be replaced by people who climbed under the new rules.
// Measured, meanE is still rising at t=1200 and level from t=2000 (+0.0003 between
// t=2000 and t=4000). Measuring drift from earlier than that scores the tail of the
// transient as if it were drift.
const HORIZON = 4800;       // 400 years
const DRIFT_FROM = 2000;    // ~165 years, where the level stops moving
const MAX_DRIFT = 0.020;
const TARGET_YEARS = 8, YEARS_LO = 6, YEARS_HI = 10;
const MIN_BELOW = 0.10;     // at least a tenth of the field still climbing
const MIN_SPREAD = 0.15;    // p90 - p10
// Interquartile range: p10-p90 can look healthy on the strength of a thin climbing
// tail while the other 80% sit in one bin. The IQR is what says the BODY of the
// distribution is spread — it was 0.010 before careers could differentiate.
const MIN_IQR = 0.15;

const pct = (arr, q) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(q * (a.length - 1))]; };

function evaluate(extra) {
  const runs = [];
  for (const seed of SEEDS) {
    const s = initSim(Object.assign({ N, M }, MONTHLY_TICK_PARAMS, { seed }, extra));
    for (let t = 1; t <= BURN_IN; t++) tick(s);

    // Time to expert, measured on entrants actually produced by turnover: watch for a
    // slot whose expertise collapses to the entrant floor, then time its climb.
    const born = new Map(); const times = [];
    let atDrift = 0, atEnd = 0;
    for (let t = 1; t <= HORIZON; t++) {
      const before = Array.from(s.E);
      const m = tick(s);
      if (t === DRIFT_FROM) atDrift = m.meanE;
      if (t === HORIZON) atEnd = m.meanE;
      for (let i = 0; i < s.N; i++) {
        if (s.E[i] < 0.10 && before[i] > 0.15) born.set(i, t);
        else if (born.has(i) && s.E[i] >= EXPERT_THRESHOLD) { times.push(t - born.get(i)); born.delete(i); }
      }
    }
    times.sort((a, b) => a - b);
    const Es = Array.from(s.E);
    runs.push({
      years: times.length ? times[Math.floor(times.length / 2)] / TICKS_PER_YEAR : Infinity,
      reached: times.length,
      meanE: Es.reduce((a, b) => a + b, 0) / s.N,
      p10: pct(Es, 0.10), p25: pct(Es, 0.25), p50: pct(Es, 0.50), p75: pct(Es, 0.75), p90: pct(Es, 0.90),
      below: Es.filter((e) => e < EXPERT_THRESHOLD).length / s.N,
      drift: atEnd - atDrift,
    });
  }
  const avg = (k) => runs.reduce((a, r) => a + r[k], 0) / runs.length;
  return {
    years: avg("years"), meanE: avg("meanE"), p10: avg("p10"), p25: avg("p25"), p50: avg("p50"),
    p75: avg("p75"), p90: avg("p90"), below: avg("below"), drift: avg("drift"),
    spread: avg("p90") - avg("p10"), iqr: avg("p75") - avg("p25"),
  };
}

function verdict(r) {
  if (!isFinite(r.years)) return "never";
  if (r.years < YEARS_LO || r.years > YEARS_HI) return "timing";
  if (Math.abs(r.drift) > MAX_DRIFT) return "DRIFTS";
  if (r.below < MIN_BELOW || r.spread < MIN_SPREAD) return "flat";
  if (r.iqr < MIN_IQR) return "spike";     // spread tail, but the body is a point mass
  return "USABLE";
}

if (process.argv.includes("--verify")) {
  const cap = parseFloat(process.env.CAP || "0.0056");
  const dr = parseFloat(process.env.DR || String(PIPELINE_PARAMS.decayRate));
  const ten = parseFloat(process.env.TEN || "8");
  const apt = parseFloat(process.env.APT || String(PIPELINE_PARAMS.aptitudeSpread));
  for (const [name, v] of [["CAP", cap], ["DR", dr], ["TEN", ten], ["APT", apt]]) {
    if (!Number.isFinite(v)) throw new Error(`${name} is not a number (${v}) — a non-numeric value here silently switches a mechanism off`);
  }
  console.log(`verify cap=${cap} decay=${dr} seniorTenure=${ten}y | aptitude=${apt} (N=${N}, M=${M}, no AI)\n`);
  const r = evaluate({ learningCap: cap, decayRate: dr, seniorTenureYears: ten,
    aptitudeSpread: apt });
  console.log("  median years to expert ", r.years.toFixed(1), ` (target ${TARGET_YEARS})`);
  console.log("  meanE                  ", r.meanE.toFixed(4));
  console.log("  distribution p10/p50/p90", r.p10.toFixed(3), r.p50.toFixed(3), r.p90.toFixed(3));
  console.log("  interdecile spread     ", r.spread.toFixed(3), "(was 0.025 before the pipeline)");
  console.log("  interquartile range    ", r.iqr.toFixed(3), "(was 0.010 — the body of the distribution)");
  console.log("  share below expert     ", (r.below * 100).toFixed(1) + "%");
  console.log("  drift over the horizon ", (r.drift >= 0 ? "+" : "") + r.drift.toFixed(4),
    Math.abs(r.drift) <= MAX_DRIFT ? "(stationary)" : "(DRIFTS)");
  console.log("  verdict                ", verdict(r));
  process.exit(0);
}

const CAPS = [0.0080, 0.0065, 0.0056, 0.0048, 0.0040];
const DECAYS = [0.018, 0.021, 0.024, 0.027];
const TENURE = 8;

console.log("Entrant-pipeline calibration");
console.log(`  N=${N} M=${M}, monthly tick, no AI, ${SEEDS.length} seeds`);
console.log(`  seniorTenureYears = ${TENURE} (learn from members past ${TENURE} years, not from fellow trainees)`);
console.log(`  accept: ${YEARS_LO}-${YEARS_HI}y to expert, |drift| <= ${MAX_DRIFT}, >= ${(MIN_BELOW * 100)}% below expert, spread >= ${MIN_SPREAD}`);
console.log(`  cells show: years-to-expert / meanE / interquartile range / verdict\n`);
console.log("  " + "cap\\decay".padEnd(12) + DECAYS.map((d) => String(d).padStart(22)).join(""));

const results = [];
for (const cap of CAPS) {
  let row = "  " + String(cap).padEnd(12);
  for (const dr of DECAYS) {
    const r = evaluate(Object.assign({ learningCap: cap, decayRate: dr, seniorTenureYears: TENURE }, {
      aptitudeSpread: PIPELINE_PARAMS.aptitudeSpread,
    }));
    const v = verdict(r);
    results.push({ cap, dr, ...r, verdict: v });
    const yrs = isFinite(r.years) ? r.years.toFixed(1) + "y" : "never";
    row += `${yrs}/${r.meanE.toFixed(2)}/${r.iqr.toFixed(2)}/${v}`.padStart(22);
  }
  console.log(row);
}

const usable = results.filter((r) => r.verdict === "USABLE");
console.log(`\n${usable.length} usable cell(s).`);
if (usable.length) {
  usable.sort((a, b) => (Math.abs(a.years - TARGET_YEARS) + Math.abs(a.drift) * 50) -
                        (Math.abs(b.years - TARGET_YEARS) + Math.abs(b.drift) * 50));
  const best = usable[0];
  console.log(`\nrecommended: learningCap=${best.cap}, decayRate=${best.dr}, seniorTenureYears=${TENURE}`);
  console.log(`  ${best.years.toFixed(1)}y to expert · meanE ${best.meanE.toFixed(4)} · ` +
    `p10-p90 ${best.p10.toFixed(3)}-${best.p90.toFixed(3)} · ${(best.below * 100).toFixed(0)}% below expert · ` +
    `drift ${(best.drift >= 0 ? "+" : "") + best.drift.toFixed(4)}`);
} else {
  console.log("Widen the grid, or relax a criterion — but say which one, and why, in the commit.");
}
