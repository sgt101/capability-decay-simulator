#!/usr/bin/env node
// How much of the capability story is CAPABILITY_RATIO?
//
//   node src/rho_sensitivity.js --config data/experiments/experiment.1.json [options]
//
// w(E) = rho^((E - theta)/(1 - theta)) converts expertise into what a person is worth.
// theta has an empirical argument behind it (expert_threshold_sensitivity.js); rho does
// not. It is a stated assumption -- "one person at the ceiling is worth a thousand who
// merely qualify" -- it appears in engine.js and nowhere else, and every capability
// magnitude reported scales with it. This measures how much.
//
// WHY THIS IS CHEAP. capabilityWeight() feeds output metrics only: tick() destructures
// { Ebar, count, Teach, transferEff } from institutionStats() and never reads capability,
// so rho cannot touch the trajectory of E. One set of runs therefore yields EVERY rho
// simultaneously -- the sweep costs exactly one pass, not one pass per rho. If that ever
// stops being true this script silently becomes wrong, so it is asserted at startup.
//
// WHY IT RE-RUNS RATHER THAN READING results/. The obvious approach is to recompute
// capability from stored expertise. It is not available: results/*.csv hold scalar
// summaries per row -- meanE, percentiles, shareExpert, and systemCapability already
// collapsed at rho = 1000. C = sum_i w(E_i) l(E_i) is a sum over the whole population,
// and no set of summary statistics recovers it. The E array has to exist, so the runs
// have to happen again. They are reproducible from the same configs and seeds, so the
// numbers match the reports cell for cell.
//
// Reads the SAME experiment configs the reports are built from, so a cell here is the
// same cell there. Grids are large (21x21x3x2 = 2,646 runs for a worldmodel pairing), so
// --stride subsamples the axes; the default keeps the endpoints and the middle of each.
//
// Options:
//   --config PATH      experiment JSON, as in data/experiments/ (required)
//   --rho LIST         comma-separated, default 1,2,4,8,...,2048
//   --stride N         take every Nth grid value on each axis (default 4)
//   --replicates N     replicates per cell, independent of the config's own count (default: 3)
//   --at TICK          which recorded tick to report (default: the last one)
//   --out DIR          output directory (default results/rho/<config basename>)
//   --workers N        default: CPU count - 1
//   --full-csv         write every recorded tick, not just --at (much larger)
//   --from-csv         rebuild rho_report.html from OUT/rho_runs.csv instead of
//                      re-simulating — for a change to how the report is computed from
//                      already-collected numbers. Needs the same --config, --rho, --stride
//                      and --at the CSV was written with, to reconstruct matching cells.
//   --index            (alone) rebuild results/rho/index.html from existing runs and exit
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const engine = require("./engine.js");
const { loadWorldModel } = require("./world_model.js");
const paths = require("./paths.js");

const THETA = engine.EXPERT_THRESHOLD;

// The whole design rests on rho being an output-only constant. Verified rather than
// trusted: run two short sims whose ONLY difference is that one reads capability out.
// If a future edit feeds capability back into the update, E would diverge and every
// number below would be a different experiment per rho.
function assertRhoIsOutputOnly() {
  const p = { N: 200, M: 10, seed: 5, aiEnabled: false };
  const a = engine.initSim(p), b = engine.initSim(p);
  for (let t = 0; t < 60; t++) {
    engine.tick(a);
    engine.tick(b);
    engine.institutionStats(b);          // the capability-computing path, run extra
  }
  for (let i = 0; i < a.N; i++) {
    if (a.E[i] !== b.E[i]) {
      console.error("[rho] capability computation now perturbs the trajectory of E.");
      console.error("  This script assumes rho is an output-only constant, which is what");
      console.error("  makes one pass serve every rho. That assumption no longer holds.");
      process.exit(1);
    }
  }
}

/* ------------------------------- capability at many rho ------------------------------- */
// C(rho) = sum_i rho^((E_i - theta)/(1 - theta)) * l(E_i), with l = 1 when AI is off.
// Written as exp(k (E - theta)) with k = ln(rho)/(1 - theta) so the per-rho cost is one
// exp() rather than one pow(); mathematically identical.
function capabilities(state, rhos) {
  const p = state.params;
  const aiLevel = p.aiEnabled ? p.aiLevelFraction * state.startTopE : null;
  const out = rhos.map(() => ({ C: 0, CHuman: 0 }));
  const ks = rhos.map((r) => Math.log(r) / (1 - THETA));
  for (let i = 0; i < state.N; i++) {
    const e = state.E[i] - THETA;
    const lev = p.aiEnabled ? engine.aclLeverage(state.E[i], aiLevel, p) : 1;
    for (let q = 0; q < ks.length; q++) {
      const w = Math.exp(ks[q] * e);
      out[q].CHuman += w;
      out[q].C += w * lev;
    }
  }
  return out;
}

/* ------------------------------------ job running ------------------------------------ */
function runJob(job, rhos, wm) {
  const params = Object.assign({}, job.params);
  if (params.graphSource === "worldModel") params.worldModel = wm;
  params.seed = job.seed;
  const s = engine.initSim(params);
  const want = new Set(job.recordAt);
  const rows = [];
  for (let t = 1; t <= job.horizon; t++) {
    engine.tick(s);
    if (!want.has(t)) continue;
    let sumE = 0;
    for (let i = 0; i < s.N; i++) sumE += s.E[i];
    const caps = capabilities(s, rhos);
    rows.push({ t, meanE: sumE / s.N, caps });
  }
  return rows;
}

if (!isMainThread) {
  const { rhos, wmSpec } = workerData;
  let wm = null;
  if (wmSpec) {
    wm = loadWorldModel(
      JSON.parse(fs.readFileSync(path.resolve(paths.DATA, wmSpec.worldModelPath), "utf8")),
      JSON.parse(fs.readFileSync(path.resolve(paths.DATA, wmSpec.mobilityCostsPath), "utf8")),
      wmSpec.worldModelOptions || {});
  }
  parentPort.on("message", (job) => {
    if (job === null) return process.exit(0);
    parentPort.postMessage({ id: job.id, rows: runJob(job, rhos, wm) });
  });
  return;
}

/* --------------------------------------- main ---------------------------------------- */
function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

// Rebuilding the cross-config index needs no runs, so it is handled before --config is
// demanded. Each experiment writes rho_summary.json alongside its report; the index is
// assembled from whatever is on disk, so it never needs the sweeps repeated.
if (process.argv.includes("--index") && !arg("config")) {
  writeIndex();
  process.exit(0);
}

const configPath = arg("config");
if (!configPath) {
  console.error("usage: node src/rho_sensitivity.js --config data/experiments/experiment.1.json [--rho 1,2,4,...,2048]");
  console.error("                                   [--stride 4] [--replicates 3] [--at TICK] [--out DIR] [--workers N]");
  process.exit(1);
}
assertRhoIsOutputOnly();

const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
// Powers of two from 1 to 2048, so the curve is resolved rather than sampled at four
// points, and anchored at the degenerate end: rho=1 makes w(E) === 1 for every E (no
// premium for expertise at all — capability collapses to plain headcount), which is a
// meaningful reference point for "how much does the convexity assumption itself matter",
// not just how big it is. The shipped CAPABILITY_RATIO is ALWAYS included even when not
// asked for: it is the reference the rank correlations are measured against, and a sweep
// that omitted it would silently compare everything to whichever value happened to come
// first.
const RHOS = Array.from(new Set(
  arg("rho", "1,2,4,8,16,32,64,128,256,512,1024,2048").split(",").map(Number)
    .concat([engine.CAPABILITY_RATIO]))).sort((a, b) => a - b);
if (RHOS.some((r) => !(r > 0))) {
  console.error("[rho] every rho must be > 0 — w(E) = rho^((E-theta)/(1-theta)) is undefined for rho <= 0");
  process.exit(1);
}
// Validated, not clamped: parseInt("") is NaN, Math.max(1, NaN) is NaN, and `i % NaN`
// is never 0 -- so a missing --stride would silently reduce every axis to a single value
// and report a one-cell "sweep" as though it had run. Fail instead.
const STRIDE = parseInt(arg("stride", "4"), 10);
if (!Number.isInteger(STRIDE) || STRIDE < 1) {
  console.error(`[rho] --stride must be an integer >= 1, got "${arg("stride", "4")}"`);
  process.exit(1);
}
// NOT capped at cfg.replicates. This script re-simulates from scratch rather than
// reading the report's own runs (see "WHY IT RE-RUNS" above), so its replicate count is
// independent of whatever the report used — capping it there only threw away precision
// this sweep could otherwise have. Validated for the same reason STRIDE is: a bad value
// must fail loudly rather than silently run zero replicates.
// let, not const: --from-csv corrects this below to the replicate count the CSV was
// actually written with, rather than trust --replicates was passed to match it.
let REPS = parseInt(arg("replicates", "3"), 10);
if (!Number.isInteger(REPS) || REPS < 1) {
  console.error(`[rho] --replicates must be an integer >= 1, got "${arg("replicates", "3")}"`);
  process.exit(1);
}
const OUT = arg("out", path.join(paths.ROOT, "results", "rho", path.basename(configPath, ".json")));
const FULL_CSV = process.argv.includes("--full-csv");   // every recorded tick, not just --at
const WORKERS = Math.max(1, parseInt(arg("workers", String(Math.max(1, os.cpus().length - 1))), 10));

if (cfg.mode && cfg.mode !== "grid") {
  console.error(`[rho] only grid configs are supported; ${configPath} is mode "${cfg.mode}"`);
  process.exit(1);
}
const AXES = Object.keys(cfg.params);
// Subsample each axis, always keeping the last value so the sweep still spans its full
// range. A stride that dropped the endpoint would narrow the experiment silently.
const axisValues = AXES.map((k) => {
  const v = cfg.params[k].values;
  if (!v) { console.error(`[rho] axis ${k} has no "values" — ranges are not supported here`); process.exit(1); }
  const out = v.filter((_, i) => i % STRIDE === 0);
  if (out[out.length - 1] !== v[v.length - 1]) out.push(v[v.length - 1]);
  return out;
});
const RECORD_AT = cfg.recordAt && cfg.recordAt.length ? cfg.recordAt : [cfg.horizon];
const AT = parseInt(arg("at", String(RECORD_AT[RECORD_AT.length - 1])), 10);
if (!RECORD_AT.includes(AT)) {
  console.error(`[rho] --at ${AT} is not a recorded tick (${RECORD_AT[0]}..${RECORD_AT[RECORD_AT.length - 1]})`);
  process.exit(1);
}

// Cartesian product of the subsampled axes.
const combos = axisValues.reduce((acc, vals, ax) =>
  acc.flatMap((c) => vals.map((v) => Object.assign({}, c, { [AXES[ax]]: v }))), [{}]);

// --from-csv: rebuild the report from a rho_runs.csv this script already wrote, instead
// of re-simulating. Every number the report needs — per (cell, arm, rho) capability,
// averaged over replicates — is already sitting in that file (that is the whole point of
// writing it as long-form CSV rather than only ever deriving the report in-process). This
// exists for changes to how the report is COMPUTED from those numbers (a different
// central-tendency statistic, a new chart) that do not need a single new tick simulated.
// combos/AXES/RHOS above are recomputed the same deterministic way the original run built
// them, from the same --config and --stride, so comboIndex lines up with the CSV without
// having to trust it was labelled correctly at write time.
if (process.argv.includes("--from-csv")) {
  const csvPath = path.join(OUT, "rho_runs.csv");
  if (!fs.existsSync(csvPath)) {
    console.error(`[rho] --from-csv but ${path.relative(paths.ROOT, csvPath)} does not exist — run the sweep first`);
    process.exit(1);
  }
  const lines = fs.readFileSync(csvPath, "utf8").split("\n").filter(Boolean);
  const header = lines[0].split(",");
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) { console.error(`[rho] ${csvPath} has no "${name}" column`); process.exit(1); }
    return i;
  };
  const iCombo = col("comboIndex"), iArm = col("arm"), iT = col("t"), iRho = col("rho"),
    iMeanE = col("meanE"), iCap = col("capability");
  // (comboIndex, arm, rho) -> the capability values seen for it, one per replicate.
  const groups = new Map();
  const meanEGroups = new Map(); // (comboIndex, arm) -> meanE values; rho-independent
  const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(",");
    if (+f[iT] !== AT) continue; // a --full-csv run recorded every tick; only AT matters here
    push(groups, f[iCombo] + "|" + f[iArm] + "|" + f[iRho], +f[iCap]);
    push(meanEGroups, f[iCombo] + "|" + f[iArm], +f[iMeanE]);
  }
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const cells = combos.map((combo, ci) => {
    const treatArm = cfg.pairWithBaseline ? "treatment" : "single";
    const meanEt = meanEGroups.get(ci + "|" + treatArm), meanEb = meanEGroups.get(ci + "|baseline");
    return {
      combo,
      meanE_t: meanEt ? avg(meanEt) : NaN,
      meanE_b: meanEb ? avg(meanEb) : NaN,
      perRho: RHOS.map((r) => {
        const t = groups.get(ci + "|" + treatArm + "|" + r);
        const b = cfg.pairWithBaseline ? groups.get(ci + "|baseline|" + r) : null;
        return { Ct: t ? avg(t) : NaN, Cb: b ? avg(b) : NaN };
      }),
    };
  });
  if (!cells.every((c) => c.perRho.every((p) => Number.isFinite(p.Ct)))) {
    console.error(`[rho] --from-csv: some (cell, rho) combinations were not found in ${path.relative(paths.ROOT, csvPath)} —`
      + ` did --stride, --rho or --at change since it was written?`);
    process.exit(1);
  }
  // The report's "replicates" figure must describe what the CSV actually contains, not
  // whatever --replicates happened to default to on this invocation (easy to forget to
  // pass, and silent when forgotten -- it doesn't affect a single computed number, only
  // this one label). Every (cell, arm, rho) group has the same count by construction, so
  // the first one found stands for all of them.
  REPS = groups.values().next().value.length;
  writeReport(cells);
  console.log(`[rho] rebuilt ${path.relative(paths.ROOT, OUT)}/rho_report.html from its existing rho_runs.csv (no runs)`);
  process.exit(0);
}

const jobs = [];
combos.forEach((combo, ci) => {
  for (let r = 0; r < REPS; r++) {
    const seed = (cfg.seed || 1) + ci * 1000 + r;
    const base = Object.assign({}, cfg.fixed, combo);
    if (cfg.pairWithBaseline) {
      jobs.push({ comboIndex: ci, combo, arm: "treatment", seed, horizon: cfg.horizon, recordAt: RECORD_AT, params: Object.assign({}, base, { aiEnabled: true }) });
      // baselineParams lets the reference arm differ from the treatment arm in more than
      // aiEnabled — the recruitment set's baseline also zeroes recruitmentShockYears, so
      // "what did AI cost" does not silently become "what did AI cost on top of a freeze
      // that hits both arms". Applied AFTER aiEnabled:false, same order batch_run.js
      // uses, so a config cannot re-enable AI in the reference arm. Without this, a
      // config carrying baselineParams would run a baseline this script never intended.
      jobs.push({ comboIndex: ci, combo, arm: "baseline", seed, horizon: cfg.horizon, recordAt: RECORD_AT,
        params: Object.assign({}, base, { aiEnabled: false }, cfg.baselineParams || {}) });
    } else {
      jobs.push({ comboIndex: ci, combo, arm: "single", seed, horizon: cfg.horizon, recordAt: RECORD_AT, params: base });
    }
  }
});
jobs.forEach((j, i) => { j.id = i; });

console.log(`[rho] ${path.basename(configPath)}: ${AXES.join(" x ")}`);
console.log(`[rho] ${combos.length} cell(s) (stride ${STRIDE}) x ${REPS} replicate(s)`
  + `${cfg.pairWithBaseline ? " x 2 arms" : ""} = ${jobs.length} run(s), horizon ${cfg.horizon}`);
console.log(`[rho] rho = ${RHOS.join(", ")}  (one pass serves all of them)`);

const results = new Array(jobs.length);
let issued = 0, done = 0;
const t0 = Date.now();
const pool = [];
for (let w = 0; w < Math.min(WORKERS, jobs.length); w++) {
  const worker = new Worker(__filename, { workerData: { rhos: RHOS, wmSpec: cfg.worldModel || null } });
  pool.push(worker);
  worker.on("message", (msg) => {
    results[msg.id] = msg.rows;
    if (++done % 25 === 0 || done === jobs.length) {
      console.log(`[rho] ${done}/${jobs.length} runs (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
    if (issued < jobs.length) worker.postMessage(jobs[issued++]);
    else { worker.postMessage(null); if (done === jobs.length) finish(); }
  });
  worker.on("error", (e) => { console.error("[rho] worker failed:", e); process.exit(1); });
  worker.postMessage(jobs[issued++]);
}

/* --------------------------------- output ---------------------------------- */
function finish() {
  fs.mkdirSync(OUT, { recursive: true });
  const rowAt = (jid) => (results[jid] || []).find((r) => r.t === AT);

  // Long-form CSV: one row per run x rho x recorded tick. Everything else is derived
  // from this, so a re-analysis never needs the runs repeated.
  const lines = ["comboIndex," + AXES.join(",") + ",arm,replicate,seed,t,rho,meanE,capability,capabilityHuman"];
  const keepTick = (t) => FULL_CSV || t === AT;
  jobs.forEach((j, id) => (results[id] || []).filter((row) => keepTick(row.t)).forEach((row) =>
    row.caps.forEach((c, q) => lines.push([j.comboIndex, ...AXES.map((a) => j.combo[a]), j.arm,
      j.seed, j.seed, row.t, RHOS[q], row.meanE.toFixed(6), c.C.toExponential(6), c.CHuman.toExponential(6)].join(",")))));
  fs.writeFileSync(path.join(OUT, "rho_runs.csv"), lines.join("\n") + "\n");

  // Per-cell paired comparison at the reported tick, for each rho.
  const cells = combos.map((combo, ci) => {
    const pick = (armName) => jobs.filter((j) => j.comboIndex === ci && j.arm === armName).map((j) => rowAt(j.id)).filter(Boolean);
    const treat = pick(cfg.pairWithBaseline ? "treatment" : "single");
    const basel = cfg.pairWithBaseline ? pick("baseline") : [];
    const avg = (a, f) => a.reduce((s, x) => s + f(x), 0) / a.length;
    return {
      combo,
      meanE_t: treat.length ? avg(treat, (r) => r.meanE) : NaN,
      meanE_b: basel.length ? avg(basel, (r) => r.meanE) : NaN,
      perRho: RHOS.map((_, q) => ({
        Ct: treat.length ? avg(treat, (r) => r.caps[q].C) : NaN,
        Cb: basel.length ? avg(basel, (r) => r.caps[q].C) : NaN,
      })),
    };
  });

  writeReport(cells);
  console.log(`\n[rho] wrote ${path.relative(paths.ROOT, OUT)}/rho_runs.csv  (${lines.length - 1} rows)`);
  console.log(`[rho] wrote ${path.relative(paths.ROOT, OUT)}/rho_report.html`);
  pool.forEach((w) => w.terminate());
}

// Spearman rank correlation, used to answer the question the sweep exists for: does
// changing rho REORDER the cells, or only rescale them? A correlation of exactly 1
// means every conclusion of the form "cell A is worse than cell B" is rho-invariant.
function spearman(a, b) {
  const rank = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(v.length);
    for (let i = 0; i < idx.length;) {
      let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b), n = a.length;
  const m = (x) => x.reduce((s, y) => s + y, 0) / n;
  const ma = m(ra), mb = m(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}

// The rho at which a capability change crosses zero: below it AI reads as a net gain in
// capability, above it as a loss. Interpolated in log(rho), which is the natural scale --
// w is exponential in E with slope proportional to log(rho), so the curve is smooth there
// and not in rho. Returns null when the series never changes sign, which is the common
// and uninteresting case.
function crossover(rhos, series) {
  for (let q = 1; q < series.length; q++) {
    const a = series[q - 1], b = series[q];
    // Number.isFinite, not the global isFinite: series here can be read back from a
    // JSON summary, where a NaN correlation (see spearman()) round-trips to null, and
    // the coercing global isFinite(null) is true (null -> 0), which would silently read
    // a "not computable" cell as a data point at zero instead of skipping it.
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
    if ((a < 0) === (b < 0)) continue;
    const f = -a / (b - a);
    return Math.exp(Math.log(rhos[q - 1]) + f * (Math.log(rhos[q]) - Math.log(rhos[q - 1])));
  }
  return null;
}

/* ------------------------------------- charting -------------------------------------- */
// Inline SVG, no library: these pages are read from disk as often as over HTTP, and a
// chart that needs a CDN is a chart that is blank half the time.
//
// x is log(rho) throughout -- see crossover() for why that is the right scale.
function lineChart(rhos, series, opts) {
  const W = 560, H = 200, L = 52, R = 14, T = 14, B = 34;
  const xs = rhos.map((r) => Math.log(r));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  let y0 = opts.y0 !== undefined ? opts.y0 : Math.min(...all);
  let y1 = opts.y1 !== undefined ? opts.y1 : Math.max(...all);
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
  const px = (x) => L + ((x - x0) / (x1 - x0 || 1)) * (W - L - R);
  const py = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const parts = [];
  // zero rule, where zero is inside the range -- the sign change is the whole point
  if (y0 < 0 && y1 > 0) parts.push(`<line x1="${L}" y1="${py(0).toFixed(1)}" x2="${W - R}" y2="${py(0).toFixed(1)}" class="zero"/>`);
  if (opts.markRho) {
    const mx = px(Math.log(opts.markRho));
    parts.push(`<line x1="${mx.toFixed(1)}" y1="${T}" x2="${mx.toFixed(1)}" y2="${H - B}" class="mark"/>`);
    parts.push(`<text x="${(mx + 4).toFixed(1)}" y="${T + 10}" class="lbl">shipped &rho;=${opts.markRho}</text>`);
  }
  [y0 + pad, y1 - pad].forEach((v) => parts.push(
    `<text x="${L - 6}" y="${(py(v) + 3).toFixed(1)}" class="ax" text-anchor="end">${v.toFixed(opts.dp === undefined ? 2 : opts.dp)}</text>`));
  rhos.forEach((r, i) => {
    if (rhos.length > 8 && i % 2) return;
    parts.push(`<text x="${px(xs[i]).toFixed(1)}" y="${H - B + 14}" class="ax" text-anchor="middle">${r}</text>`);
  });
  series.forEach((s) => {
    const pts = s.values.map((v, i) => (Number.isFinite(v) ? `${px(xs[i]).toFixed(1)},${py(v).toFixed(1)}` : null)).filter(Boolean);
    parts.push(`<polyline points="${pts.join(" ")}" class="ln" style="stroke:${s.color}"/>`);
    s.values.forEach((v, i) => { if (Number.isFinite(v)) parts.push(`<circle cx="${px(xs[i]).toFixed(1)}" cy="${py(v).toFixed(1)}" r="2.5" style="fill:${s.color}"/>`); });
  });
  parts.push(`<text x="${L}" y="${H - 4}" class="ax">&rho; (log scale)</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${opts.alt || ""}">${parts.join("")}</svg>`;
}

// ------------------------------- LaTeX for the charts ---------------------------------
// The charts are also emitted as pgfplots source, copyable from the page and written to
// .tex beside it. Preferring code over an image file: a pasted SVG or PNG carries the
// report's fonts and colours into a document that has its own, and cannot be restyled or
// rescaled once it is in. pgfplots redraws from the numbers, so the figure takes the
// document's typeface and the data stays legible in the source.
//
// Self-contained apart from the package line: colours are defined inline rather than
// assumed, because a snippet that silently picks up whatever `blue` means in the host
// preamble is not reproducible.
//
// x is log base 2 -- the sweep is powers of two, and w is exponential in E with slope
// proportional to log(rho), so equal ratios are the equal steps.
function texEscape(t) {
  return String(t).replace(/\\/g, "\\textbackslash{}").replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");
}

function pgfplot(rhos, series, opts) {
  const L = [];
  L.push(`% ${opts.caption}`);
  L.push(`% Generated by src/rho_sensitivity.js on ${new Date().toISOString().slice(0, 10)}`);
  L.push("% Requires: \\usepackage{pgfplots} and \\pgfplotsset{compat=1.18} in the preamble.");
  L.push("\\begin{tikzpicture}");
  series.forEach((sr, i) => L.push(`  \\definecolor{rhoC${i}}{HTML}{${sr.tex.replace("#", "")}}`));
  L.push("  \\begin{axis}[");
  L.push("    width=\\linewidth, height=6cm,");
  L.push("    xmode=log, log basis x=2, log ticks with fixed point,");
  L.push(`    xlabel={$\\rho$}, ylabel={${opts.ylabel}},`);
  if (opts.ymin !== undefined) L.push(`    ymin=${opts.ymin}, ymax=${opts.ymax},`);
  L.push("    grid=major, grid style={gray!20},");
  L.push("    tick align=outside, tick pos=left,");
  if (series.length > 1) L.push("    legend pos=south east, legend cell align=left, legend style={font=\\footnotesize, draw=gray!40},");
  L.push("  ]");
  // The reference line first, so the data draws over it.
  if (opts.zeroLine) {
    L.push(`    \\addplot[gray, dashed, forget plot, domain=${rhos[0]}:${rhos[rhos.length - 1]}] {0};`);
  }
  if (opts.markRho) {
    L.push(`    \\draw[gray!60, dotted] (axis cs:${opts.markRho},\\pgfkeysvalueof{/pgfplots/ymin})`
      + ` -- (axis cs:${opts.markRho},\\pgfkeysvalueof{/pgfplots/ymax});`);
    L.push(`    \\node[gray!70, font=\\scriptsize, anchor=south west, rotate=90]`
      + ` at (axis cs:${opts.markRho},\\pgfkeysvalueof{/pgfplots/ymin}) {shipped $\\rho=${opts.markRho}$};`);
  }
  series.forEach((sr, i) => {
    const pts = sr.values.map((v, q) => (Number.isFinite(v) ? `(${rhos[q]},${(+v).toFixed(4)})` : null))
      .filter(Boolean).join(" ");
    L.push(`    \\addplot[color=rhoC${i}, mark=*, mark size=1.2pt, thick] coordinates {${pts}};`);
    if (series.length > 1) L.push(`    \\addlegendentry{${texEscape(sr.label || ("series " + (i + 1)))}}`);
  });
  L.push("  \\end{axis}");
  L.push("\\end{tikzpicture}");
  return L.join("\n") + "\n";
}

// A function, not a const: writeIndex() runs before this point in the file when
// --index is passed alone, and a const would still be in its temporal dead zone.
function css() { return `
:root{--bg:#eef0ee;--panel:#fff;--ink:#14181a;--muted:#5c6360;--rule:#d7dad6;--accent:#35636b;--warn:#a4553a}
@media(prefers-color-scheme:dark){:root{--bg:#101314;--panel:#171b1d;--ink:#e6e8e6;--muted:#9aa19d;--rule:#2a2f31;--accent:#7fb3bd;--warn:#d08b6e}}
*{box-sizing:border-box}body{margin:0;padding:2.5rem 1.25rem 4rem;background:var(--bg);color:var(--ink);
font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:62rem;margin:0 auto}h1{font-size:1.3rem;margin:0 0 .5rem}h2{font-size:1rem;margin:2.2rem 0 .6rem}
p{color:var(--muted);max-width:46rem}a{color:var(--accent)}
table{border-collapse:collapse;width:100%;font-size:.8rem;background:var(--panel);border:1px solid var(--rule)}
th,td{padding:.32rem .5rem;border-bottom:1px solid var(--rule);text-align:left;white-space:nowrap}
td.n,th.n{text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
td.neg{color:var(--warn)}
.wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.facts{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.74rem;color:var(--muted)}
.key{background:var(--panel);border:1px solid var(--rule);border-left:3px solid var(--accent);padding:.8rem 1rem;border-radius:4px}
.key p{color:inherit;max-width:none;margin:0}
.chart{width:100%;max-width:560px;height:auto;background:var(--panel);border:1px solid var(--rule);border-radius:4px}
.chart .ln{fill:none;stroke-width:1.8}
.chart .zero{stroke:var(--warn);stroke-width:1;stroke-dasharray:3 3}
.chart .mark{stroke:var(--muted);stroke-width:1;stroke-dasharray:2 3}
.chart .ax,.chart .lbl{font:10px ui-monospace,monospace;fill:var(--muted)}
.charts{display:flex;flex-wrap:wrap;gap:1rem}
.fig{flex:1 1 320px;min-width:0}
.figbar{display:flex;align-items:center;gap:.4rem;margin:.3rem 0 0}
.copy-btn{display:inline-flex;align-items:center;gap:.3rem;background:var(--panel);color:var(--muted);
border:1px solid var(--rule);border-radius:4px;padding:.2rem .45rem;font:inherit;font-size:.72rem;cursor:pointer}
.copy-btn:hover{color:var(--ink);border-color:var(--accent)}
.copy-btn svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.8}
.copy-btn.ok{color:var(--accent);border-color:var(--accent)}
.figcap{font-size:.72rem;color:var(--muted);margin:.15rem 0 0}
`; }

// A chart plus its "copy as LaTeX" control. The LaTeX itself is built in Node and
// injected as JSON: assembling pgfplots source in browser JS means backslashes surviving
// two levels of escaping, which is exactly the class of bug that is invisible until
// someone pastes the result into a document.
function figure(id, svg, caption) {
  return `<div class="fig">${svg}
  <div class="figbar">
    <button class="copy-btn" data-tex="${id}" type="button" title="Copy pgfplots source for this chart">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/>`
    + `<path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg><span>Copy LaTeX</span>
    </button>
  </div>
  <p class="figcap">${caption}</p>
</div>`;
}

// Clipboard, with the same fallback the other report pages use: navigator.clipboard is
// unavailable outside a secure context, and these pages are opened from disk as often as
// over HTTP, where file:// is not secure and the API is simply absent.
function clipboardScript(texById) {
  const blob = JSON.stringify(texById).replace(/</g, "\\u003c");
  return `<script>
(function () {
  var TEX = ${blob};
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.top = "-1000px";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? resolve() : reject(new Error("execCommand refused")); }
      catch (e) { reject(e); }
      finally { document.body.removeChild(ta); }
    });
  }
  document.querySelectorAll(".copy-btn[data-tex]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var label = btn.querySelector("span");
      var was = label.textContent;
      copyText(TEX[btn.getAttribute("data-tex")]).then(function () {
        label.textContent = "Copied"; btn.classList.add("ok");
      }, function () {
        label.textContent = "Press Ctrl+C";
      });
      setTimeout(function () { label.textContent = was; btn.classList.remove("ok"); }, 1800);
    });
  });
})();
<\/script>`;
}

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function page(title, body, tail) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>${css()}</style></head><body><main>${body}</main>${tail || ""}</body></html>`;
}

function writeReport(cells) {
  const pct = (t, b) => (b > 0 ? ((t - b) / b) * 100 : NaN);
  const changes = RHOS.map((_, q) => cells.map((c) => pct(c.perRho[q].Ct, c.perRho[q].Cb)));
  const ref = RHOS.indexOf(engine.CAPABILITY_RATIO);   // guaranteed present, see RHOS
  const rhoCorr = RHOS.map((_, q) => spearman(changes[ref], changes[q]));
  const dE = cells.map((c) => c.meanE_t - c.meanE_b);
  // True median: the middle value for odd n, the average of the middle two for even n.
  // (Previously this picked f[floor(n/2)] unconditionally, which for even n is the upper
  // of the two middle values rather than their average — every cell count in this study
  // happens to be even, so that quirk was live everywhere, not an edge case.)
  const median = (a) => {
    const f = a.filter(Number.isFinite).sort((x, y) => x - y), n = f.length;
    if (!n) return NaN;
    return n % 2 ? f[(n - 1) / 2] : (f[n / 2 - 1] + f[n / 2]) / 2;
  };
  const medians = RHOS.map((_, q) => median(changes[q]));
  const cellSeries = cells.map((_, i) => RHOS.map((_, q) => changes[q][i]));
  const cellCross = cellSeries.map((s) => crossover(RHOS, s));
  const medCross = crossover(RHOS, medians);
  // How many cells flip sign anywhere in the swept range. This is the number that says
  // whether the direction of the capability result is a finding or an assumption.
  const flipped = cellCross.filter((x) => x !== null).length;

  const summary = {
    config: path.basename(configPath), axes: AXES, cells: cells.length, replicates: REPS,
    stride: STRIDE, tick: AT, rhos: RHOS, shippedRho: engine.CAPABILITY_RATIO,
    rankCorr: rhoCorr, medianChange: medians, medianCrossover: medCross,
    cellsFlippingSign: flipped, generated: new Date().toISOString().slice(0, 10),
    report: "rho_report.html",
  };
  fs.writeFileSync(path.join(OUT, "rho_summary.json"), JSON.stringify(summary, null, 2));

  const rows = cells.map((c, i) => "<tr><td>" + AXES.map((a) => esc(c.combo[a])).join("</td><td>")
    + "</td><td class='n'>" + dE[i].toFixed(4) + "</td>"
    + RHOS.map((_, q) => {
      const v = changes[q][i];
      return `<td class="n${Number.isFinite(v) && v < 0 ? " neg" : ""}">${Number.isFinite(v) ? v.toFixed(2) : "—"}</td>`;
    }).join("")
    + `<td class="n">${cellCross[i] === null ? "—" : Math.round(cellCross[i])}</td></tr>`).join("\n");

  const name = path.basename(configPath, ".json");
  const ACCENT_TEX = "35636B";
  const figs = [
    { id: "rankcorr", file: "rho_rankcorr.tex",
      values: rhoCorr, opts: { y0: -1, y1: 1, dp: 2 },
      ylabel: `rank correlation vs $\\rho=${engine.CAPABILITY_RATIO}$`,
      ymin: -1, ymax: 1, zeroLine: false,
      caption: `Rank correlation of per-cell capability change against the shipped &rho;. 1.0 means the ordering of cells is identical.`,
      texCaption: `Capability ratio sensitivity, ${name}: rank correlation` },
    { id: "median", file: "rho_median.tex",
      values: medians, opts: { dp: 1 },
      ylabel: "median capability change (\\%)",
      zeroLine: true,
      caption: "Median capability change, per cent. The dashed line is zero: where the curve crosses it, AI stops reading as a gain and starts reading as a loss.",
      texCaption: `Capability ratio sensitivity, ${name}: median capability change` },
  ];
  const texById = {};
  const blocks = figs.map((f) => {
    const svg = lineChart(RHOS, [{ values: f.values, color: "var(--accent)" }],
      Object.assign({ markRho: engine.CAPABILITY_RATIO, alt: f.texCaption }, f.opts));
    const tex = pgfplot(RHOS, [{ values: f.values, tex: ACCENT_TEX }], {
      caption: f.texCaption, ylabel: f.ylabel, ymin: f.ymin, ymax: f.ymax,
      zeroLine: f.zeroLine, markRho: engine.CAPABILITY_RATIO,
    });
    texById[f.id] = tex;
    // Also written to disk. The copy button is the intended route, but a page opened in
    // a browser that refuses clipboard access on file:// still has to be usable.
    fs.writeFileSync(path.join(OUT, f.file), tex);
    return figure(f.id, svg, f.caption);
  });
  const charts = `<div class="charts">\n${blocks.join("\n")}\n</div>`;

  writeReportPage(cells.length, rows, rhoCorr, medians, medCross, flipped, charts, texById);
}

function writeReportPage(nCells, rows, rhoCorr, medians, medCross, flipped, charts, texById) {
  const body = `
<h1>Capability ratio sensitivity — ${esc(path.basename(configPath, ".json"))}</h1>
<p>How much of the capability result is the assumed constant &rho;? The capability weight is
w(E) = &rho;<sup>(E&minus;&theta;)/(1&minus;&theta;)</sup> with &theta; = ${THETA}, so &rho;
asserts that one person at the ceiling is worth &rho; people at the expert threshold. &theta;
has an empirical argument behind it; &rho; does not &mdash; it is a stated assumption that
appears in engine.js and nowhere else. It affects reported output only, never the update, so
one set of runs yields every &rho; here.</p>
<p class="facts">config: ${esc(path.basename(configPath))} &middot; axes: ${AXES.map(esc).join(" x ")}
&middot; ${nCells} cells (stride ${STRIDE}) &middot; ${REPS} replicates &middot; t = ${AT}
&middot; ${RHOS.length} values of &rho; &middot; generated ${new Date().toISOString().slice(0, 10)}
&middot; <a href="../index.html">all experiments</a></p>

${charts}

<h2>Summary</h2>
<div class="wrap"><table>
<tr><th class="n">&rho;</th><th class="n">slope d ln w/dE</th><th class="n">rank corr. vs shipped</th><th class="n">median capability change (%)</th></tr>
${RHOS.map((r, q) => `<tr><td class="n">${r}${r === engine.CAPABILITY_RATIO ? " *" : ""}</td>`
    + `<td class="n">${(Math.log(r) / (1 - THETA)).toFixed(2)}</td>`
    + `<td class="n">${Number.isFinite(rhoCorr[q]) ? rhoCorr[q].toFixed(4) : "—"}</td>`
    + `<td class="n${Number.isFinite(medians[q]) && medians[q] < 0 ? " neg" : ""}">${Number.isFinite(medians[q]) ? medians[q].toFixed(2) : "—"}</td></tr>`).join("\n")}
</table></div>
<p class="facts">* the shipped CAPABILITY_RATIO, and the reference the correlations are measured against</p>

<h2>Reading this</h2>
<div class="key"><p>Two different questions, and they have different answers.</p>
<p style="margin-top:.6rem"><strong>Does &rho; reorder the cells?</strong> That is the rank
correlation. Where it is 1.000 every comparative claim &mdash; &ldquo;this condition is worse
than that one&rdquo; &mdash; is independent of the assumption. Where it is not, the reported
ordering holds only at the &rho; that produced it.</p>
<p style="margin-top:.6rem"><strong>Does &rho; set the sign?</strong> That is the crossover
column. A natural guess is that &rho; only rescales, because capability change would then be
exp(k&middot;&Delta;E) &minus; 1 with k = ln&rho;/(1&minus;&theta;). That holds only when a
condition shifts the whole expertise distribution uniformly. In general
C = &sum;<sub>i</sub> w(E<sub>i</sub>)&#8467;(E<sub>i</sub>) is a sum over the population and
&rho; decides <em>which part of it dominates</em>: at low &rho; the weight is nearly flat and C
behaves like a headcount, so the AI leverage term &#8467; drives the result; at high &rho;
almost all of C sits in the top tail, and the result is whatever happened to the best few
percent. A cell whose crossover falls inside the swept range reports a capability
<em>gain</em> below it and a <em>loss</em> above it.</p>
<p style="margin-top:.6rem"><strong>Here: ${flipped} of ${nCells} cells change sign</strong>
within &rho; = ${RHOS[0]}&ndash;${RHOS[RHOS.length - 1]}${medCross
    ? `, and the median cell crosses at &rho; &asymp; ${Math.round(medCross)}`
    : ", and the median cell does not cross"}.</p></div>

<h2>Per cell</h2>
<p>Capability change from baseline to treatment, per cent, at each &rho;. &Delta;meanE is the
same cell&rsquo;s expertise change &mdash; the quantity that does not depend on &rho; at all.
The last column is the &rho; at which that cell&rsquo;s capability change crosses zero.</p>
<div class="wrap"><table>
<tr>${AXES.map((a) => `<th>${esc(a)}</th>`).join("")}<th class="n">&Delta;meanE</th>${RHOS.map((r) => `<th class="n">${r}</th>`).join("")}<th class="n">crossover &rho;</th></tr>
${rows}
</table></div>`;
  fs.writeFileSync(path.join(OUT, "rho_report.html"),
    page("Capability ratio sensitivity", body, clipboardScript(texById)));
}

/* -------------------------------------- index ---------------------------------------- */
// One page over every experiment swept so far, assembled from the rho_summary.json each
// run leaves behind. Separate from the per-experiment reports because the question it
// answers is different: not "how does this pairing respond to rho" but "is the capability
// story rho-dependent across the study".
function writeIndex() {
  const root = path.join(paths.ROOT, "results", "rho");
  if (!fs.existsSync(root)) { console.error(`[rho] nothing to index — ${path.relative(paths.ROOT, root)} does not exist`); process.exit(1); }
  const runs = fs.readdirSync(root)
    .map((d) => path.join(root, d, "rho_summary.json"))
    .filter((f) => fs.existsSync(f))
    .map((f) => Object.assign(JSON.parse(fs.readFileSync(f, "utf8")), { dir: path.basename(path.dirname(f)) }));
  if (!runs.length) { console.error("[rho] no rho_summary.json found — run some sweeps first"); process.exit(1); }
  runs.sort((a, b) => a.dir.localeCompare(b.dir));

  // Only comparable where the rho grids match, which they will unless someone passed
  // --rho by hand for one experiment. Stated rather than silently interpolated.
  const grid = runs[0].rhos;
  const same = runs.every((r) => r.rhos.length === grid.length && r.rhos.every((v, i) => v === grid[i]));
  const palette = ["#35636b", "#a4553a", "#5b7f4e", "#7a5b8f", "#8a7136", "#3f6ea8"];
  const texById = {};
  let charts;
  if (same) {
    const mk = (key) => runs.map((r, i) => ({ values: r[key], color: palette[i % palette.length],
      tex: palette[i % palette.length].replace("#", ""), label: r.dir }));
    const figs = [
      { id: "rankcorr", file: "rho_rankcorr_all.tex", key: "rankCorr",
        opts: { y0: -1, y1: 1, dp: 2 }, ymin: -1, ymax: 1, zeroLine: false,
        ylabel: `rank correlation vs $\\rho=${runs[0].shippedRho}$`,
        caption: "Rank correlation of per-cell capability change against the shipped &rho;, by experiment.",
        texCaption: "Capability ratio sensitivity: rank correlation by experiment" },
      { id: "median", file: "rho_median_all.tex", key: "medianChange",
        opts: { dp: 1 }, zeroLine: true,
        ylabel: "median capability change (\\%)",
        caption: "Median capability change, per cent, by experiment. The dashed line is zero.",
        texCaption: "Capability ratio sensitivity: median capability change by experiment" },
    ];
    const blocks = figs.map((f) => {
      const series = mk(f.key);
      const svg = lineChart(grid, series, Object.assign({ markRho: runs[0].shippedRho, alt: f.texCaption }, f.opts));
      const tex = pgfplot(grid, series, { caption: f.texCaption, ylabel: f.ylabel,
        ymin: f.ymin, ymax: f.ymax, zeroLine: f.zeroLine, markRho: runs[0].shippedRho });
      texById[f.id] = tex;
      fs.writeFileSync(path.join(root, f.file), tex);
      return figure(f.id, svg, f.caption);
    });
    charts = `<div class="charts">\n${blocks.join("\n")}\n</div>\n`
      + `<p class="facts">${runs.map((r, i) => `<span style="color:${palette[i % palette.length]}">&#9632;</span> ${esc(r.dir)}`).join(" &middot; ")}</p>`;
  } else {
    charts = `<p class="facts">experiments were swept over different &rho; grids, so the curves are not
       overlaid; open the individual reports below.</p>`;
  }

  const body = `
<h1>Capability ratio sensitivity</h1>
<p>w(E) = &rho;<sup>(E&minus;&theta;)/(1&minus;&theta;)</sup> converts expertise into capability.
&theta; has an empirical argument behind it; &rho; is a stated assumption with none, and every
capability magnitude in the reports scales with it. These sweeps measure whether the
<em>conclusions</em> scale with it too. Regenerate with
<code>./src/run_rho_sensitivity.sh</code>.</p>
${charts}
<h2>Experiments</h2>
<div class="wrap"><table>
<tr><th>experiment</th><th>axes</th><th class="n">cells</th><th class="n">reps</th><th class="n">t</th>
<th class="n">corr. at &rho;=${grid[0]}</th><th class="n">median change at shipped &rho; (%)</th>
<th class="n">cells changing sign</th><th class="n">median crossover &rho;</th></tr>
${runs.map((r) => {
  const q = r.rhos.indexOf(r.shippedRho);
  // rankCorr/medianChange came through rho_summary.json: a NaN (see spearman() and
  // median()) serializes as null, so these read Number.isFinite rather than assume a
  // number. NaN correlation happens whenever a series has zero variance to rank at
  // all -- e.g. the "wrong" Dell'Acqua variant at rho=1, where capability collapses to
  // plain headcount and is identical in every cell, both arms, so there is nothing to
  // correlate.
  const corr = Number.isFinite(r.rankCorr[0]) ? r.rankCorr[0].toFixed(3) : "—";
  const change = Number.isFinite(r.medianChange[q]) ? r.medianChange[q].toFixed(2) : "—";
  return `<tr><td><a href="${esc(r.dir)}/rho_report.html">${esc(r.dir)}</a></td>`
    + `<td>${r.axes.map(esc).join(" x ")}</td><td class="n">${r.cells}</td><td class="n">${r.replicates}</td>`
    + `<td class="n">${r.tick}</td><td class="n">${corr}</td>`
    + `<td class="n${Number.isFinite(r.medianChange[q]) && r.medianChange[q] < 0 ? " neg" : ""}">${change}</td>`
    + `<td class="n">${r.cellsFlippingSign} / ${r.cells}</td>`
    + `<td class="n">${r.medianCrossover ? Math.round(r.medianCrossover) : "—"}</td></tr>`;
}).join("\n")}
</table></div>
<p class="facts">generated ${new Date().toISOString().slice(0, 10)}</p>`;
  fs.writeFileSync(path.join(root, "index.html"),
    page("Capability ratio sensitivity", body, clipboardScript(texById)));
  console.log(`[rho] wrote ${path.relative(paths.ROOT, root)}/index.html  (${runs.length} experiment(s))`);
}
