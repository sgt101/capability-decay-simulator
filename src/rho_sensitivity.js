#!/usr/bin/env node
// How much of the capability story is CAPABILITY_RATIO?
//
//   node src/rho_sensitivity.js --config data/experiments/experiment.1.json [options]
//
// w(E) = rho^((E - theta)/(1 - theta)) converts expertise into what a person is worth.
// NEITHER constant is measured against anything external. theta was chosen as a
// robustness midpoint -- the value making the model's own self-renewal/collapse contrast
// least dependent on theta -- and doc/paper.md records that the argument was made under
// the legacy calibration and does NOT carry over to the world-model regime these
// experiments run in (0.585 sits at the top edge of that band, not its middle; see
// expert_threshold_sensitivity.js). rho has never had an argument of either kind: it is a
// stated assumption -- "one person at the ceiling is worth a thousand who merely qualify"
// -- it appears in engine.js and nowhere else, and every capability magnitude reported
// scales with it. This measures how much.
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
//   --rho LIST         comma-separated, default 1,2,3,...,8,16,32,...,2048
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
  console.error("usage: node src/rho_sensitivity.js --config data/experiments/experiment.1.json [--rho 1,2,3,...,8,16,...,2048]");
  console.error("                                   [--stride 4] [--replicates 3] [--at TICK] [--out DIR] [--workers N]");
  process.exit(1);
}
assertRhoIsOutputOnly();

const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
// Unit steps from 1 to 8 -- resolving the low end where a step of one still roughly
// doubles rho, rather than jumping straight to the powers-of-two ladder above it -- then
// powers of two on to 2048. Not floored at 5 the way an earlier version of this comment
// argued (people routinely spend on the order of 15 years, professional development
// included, building the expertise a 30-year career then draws on, so rho=1's "no
// premium for expertise at all" is not realistic): that argument still holds, but the
// low end is worth resolving rather than skipped over. The shipped CAPABILITY_RATIO is
// ALWAYS included even when not asked for: it is the reference the rank correlations are
// measured against, and a sweep that omitted it would silently compare everything to
// whichever value happened to come first.
const RHOS = Array.from(new Set(
  arg("rho", "1,2,3,4,5,6,7,8,16,32,64,128,256,512,1024,2048").split(",").map(Number)
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

/* ------------------------------------- LaTeX ----------------------------------------- */
// Tables leave as LaTeX, charts leave as PNG. The split is deliberate: a table is
// structured text a document should typeset in its own font, while a chart drawn to match
// this report is a figure -- reproducing it as pgfplots meant maintaining a second
// renderer whose output never quite matched what the page showed. PNG keeps one drawing
// path and one appearance.
//
// Built in Node rather than assembled in browser JS: a .tex file is mostly backslashes,
// and building one browser-side means every backslash surviving two levels of escaping,
// which is exactly the class of bug that stays invisible until someone pastes the result
// into a document.
function texEscape(t) {
  return String(t).replace(/\\/g, "\\textbackslash{}").replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}");
}

// ASCII only, this provenance comment included: a .tex file carrying a stray em dash is
// an inputenc error under pdflatex, and this report's prose is full of typographic
// characters that must not follow the numbers out. No build date -- a table gets pasted
// into a document and re-exported as the data changes, and a stale one is worse than none.
function latexTable(spec) {
  const wide = spec.header.length > 10;
  const L = [];
  L.push("% " + spec.caption);
  L.push("% Generated by src/rho_sensitivity.js");
  L.push("% Requires: \\usepackage{booktabs}" + (wide ? ",graphicx" : ""));
  L.push("\\begin{table}[htbp]");
  L.push("  \\centering");
  L.push("  \\caption{" + spec.caption + "}");
  L.push("  \\label{" + spec.label + "}");
  const ind = wide ? "    " : "  ";
  if (wide) L.push("  \\resizebox{\\textwidth}{!}{%");
  L.push(ind + "\\begin{tabular}{" + spec.align + "}");
  L.push(ind + "  \\toprule");
  L.push(ind + "  " + spec.header.join(" & ") + " \\\\");
  L.push(ind + "  \\midrule");
  spec.rows.forEach((r) => L.push(ind + "  " + r.join(" & ") + " \\\\"));
  L.push(ind + "  \\bottomrule");
  L.push(ind + "\\end{tabular}");
  if (wide) L.push("  }");
  if (spec.note) L.push("  \\par\\smallskip\\footnotesize " + spec.note);
  L.push("\\end{table}");
  return L.join("\n") + "\n";
}

// LaTeX wants a plain number or an explicit marker, never the page's em dash.
// A declaration, not a const, for the same reason css() is: writeIndex() runs before this
// point in the file when --index is passed alone, and a const would still be in its
// temporal dead zone.
function texNum(v, dp) { return Number.isFinite(v) ? v.toFixed(dp) : "n/a"; }

/* -------------------------------------- styling -------------------------------------- */
// The same tokens report.template.html defines, including its three-state theme handling:
// a bare :root light palette, a prefers-color-scheme override guarded so an explicit
// light choice still wins, and a [data-theme] pair so a toggle wins in both directions.
// These pages are opened beside the main reports and should not look like a different
// study.
//
// A function, not a const: writeIndex() runs before this point in the file when --index
// is passed alone, and a const would still be in its temporal dead zone.
function css() { return `
:root{--bg:#eef0ee;--panel:#fff;--panel-2:#f4f5f3;--ink:#14181a;--ink-muted:#5c6360;--ink-faint:#8b918d;
--rule:#d7dad6;--accent:#a8502c;--accent2:#35636b;--ref-line:#6b3fa0;--warn:#a8502c;
--shadow:0 1px 2px rgba(20,24,26,.07)}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#101314;--panel:#171b1d;--panel-2:#1d2224;
--ink:#e8eae6;--ink-muted:#93a09c;--ink-faint:#656e6b;--rule:#2b3234;--accent:#dd8259;--accent2:#7fb0b7;
--ref-line:#c79bff;--warn:#dd8259;--shadow:0 1px 3px rgba(0,0,0,.5)}}
:root[data-theme="dark"]{--bg:#101314;--panel:#171b1d;--panel-2:#1d2224;
--ink:#e8eae6;--ink-muted:#93a09c;--ink-faint:#656e6b;--rule:#2b3234;--accent:#dd8259;--accent2:#7fb0b7;
--ref-line:#c79bff;--warn:#dd8259;--shadow:0 1px 3px rgba(0,0,0,.5)}
*{box-sizing:border-box}
body{margin:0;padding:2.2rem 1.25rem 4rem;background:var(--bg);color:var(--ink);
font:14.5px/1.6 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:62rem;margin:0 auto;display:flex;flex-direction:column;gap:1.1rem}
h1{font-size:1.25rem;margin:0}
h2{font-size:1.05rem;margin:0}
h3{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);margin:0 0 .5rem}
p{margin:0 0 .6rem;color:var(--ink-muted);max-width:46rem}
p:last-child{margin-bottom:0}
a{color:var(--accent2)}
.panel{background:var(--panel);border:1px solid var(--rule);border-radius:6px;box-shadow:var(--shadow);padding:1rem}
.head{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:.5rem;margin-bottom:.7rem}
.head .sub{font-size:.78rem;color:var(--ink-muted)}
.facts{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;color:var(--ink-faint)}
table.data-table{border-collapse:collapse;width:100%;font-size:.82rem}
table.data-table th,table.data-table td{border:1px solid var(--rule);padding:.35rem .55rem;text-align:right;
font-family:ui-monospace,monospace;white-space:nowrap}
table.data-table th:first-child,table.data-table td:first-child{text-align:left}
table.data-table th{background:var(--panel-2);font-weight:600}
table.data-table td.neg{color:var(--warn)}
table.data-table tbody tr.ref td{background:var(--panel-2)}
.table-scroll{overflow:auto;max-height:480px}
.fig-toolbar{display:flex;gap:.4rem;align-items:center;justify-content:flex-end;margin:.35rem 0 0}
.copy-btn{display:inline-flex;align-items:center;gap:.4rem;padding:.28rem .6rem;font:inherit;font-size:.72rem;
color:var(--ink-muted);background:var(--panel-2);border:1px solid var(--rule);border-radius:4px;cursor:pointer}
.copy-btn:hover{color:var(--ink);border-color:var(--ink-faint)}
.copy-btn:active{transform:translateY(1px)}
.copy-btn.is-done{color:#2e7d4f;border-color:#2e7d4f}
.copy-btn.is-fail{color:#c0392b;border-color:#c0392b}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]) .copy-btn.is-done{color:#7fd4a2;border-color:#7fd4a2}
:root:not([data-theme="light"]) .copy-btn.is-fail{color:#f08a80;border-color:#f08a80}}
.copy-btn svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.8}
.canvas-wrap{position:relative;overflow-x:auto}
.canvas-wrap canvas{width:100%;min-width:460px;display:block;cursor:default}
.figcap{margin:.7rem 0 0;padding-top:.6rem;border-top:1px solid var(--rule);font-size:.74rem;
line-height:1.55;color:var(--ink-muted)}
.key{background:var(--panel-2);border:1px solid var(--rule);border-left:3px solid var(--accent2);
padding:.85rem 1rem;border-radius:4px}
.key p{color:var(--ink-muted);max-width:none}
.key b{color:var(--ink)}
`; }

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function page(title, body, tail) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>${css()}</style></head><body><main>${body}</main>${tail || ""}</body></html>`;
}

/* ------------------------------ figure + table markup -------------------------------- */
// Declarations rather than consts — see texNum() for why.
function copyIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/>'
    + '<path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
}
function saveIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/>'
    + '<path d="M4 17v3h16v-3"/></svg>';
}

// A chart plus the two PNG controls. Height is set by the client once it knows the
// container width, so the element does not jump on first draw.
function figureBlock(id, caption, h) {
  return `<div class="panel">
  <div class="canvas-wrap"><canvas id="fig-${id}" style="height:${h}px"></canvas></div>
  <div class="fig-toolbar">
    <button class="copy-btn" data-fig="${id}" data-act="copy" type="button" title="Copy this figure to the clipboard as a PNG">${copyIcon()}<span>Copy PNG</span></button>
    <button class="copy-btn" data-fig="${id}" data-act="save" type="button" title="Save this figure as a PNG file">${saveIcon()}<span>Download PNG</span></button>
  </div>
  <p class="figcap">${caption}</p>
</div>`;
}

function tableBlock(id, title, sub, tableHtml, caption) {
  return `<div class="panel">
  <div class="head"><h2>${title}</h2>${sub ? `<span class="sub">${sub}</span>` : ""}</div>
  <div class="table-scroll">${tableHtml}</div>
  <div class="fig-toolbar">
    <button class="copy-btn" data-tex="${id}" type="button" title="Copy this table as a LaTeX tabular (booktabs)">${copyIcon()}<span>Copy as LaTeX</span></button>
  </div>
  ${caption ? `<p class="figcap">${caption}</p>` : ""}
</div>`;
}

/* ------------------------------------ client script ---------------------------------- */
// Canvas, not SVG, and drawn client-side: the figures have to match report.template.html's
// panels, which are canvas, and the PNG export composites the same pixels the page shows
// rather than rasterising a second time from different source. x is log(rho) throughout --
// see crossover() for why that is the right scale.
function clientScript(figs, texById) {
  const blob = (o) => JSON.stringify(o).replace(/</g, "\\u003c");
  return `<script>
(function () {
  var FIGS = ${blob(figs)};
  var TEX = ${blob(texById)};
  var MONO = "10px ui-monospace, SF Mono, Menlo, Consolas, monospace";
  var SANS = "10px ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif";

  function cssVar(n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "#888888";
  }
  function finite(v) { return v !== null && v !== undefined && isFinite(v); }

  // Shared across every panel of a figure, so facets are comparable by eye.
  function domainOf(spec) {
    var all = [];
    spec.panels.forEach(function (p) {
      p.values.forEach(function (v) { if (finite(v)) all.push(v); });
    });
    var lo = spec.y0 !== null && spec.y0 !== undefined ? spec.y0 : Math.min.apply(null, all);
    var hi = spec.y1 !== null && spec.y1 !== undefined ? spec.y1 : Math.max.apply(null, all);
    if (!finite(lo) || !finite(hi)) { lo = -1; hi = 1; }
    if (lo === hi) { lo -= 1; hi += 1; }
    var pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  }

  function drawPanel(ctx, box, spec, panel, dom, small) {
    var rhos = spec.rhos;
    var xs = rhos.map(function (r) { return Math.log(r); });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var padL = small ? 40 : 56, padR = small ? 10 : 16;
    // A two-line facet label needs room above the plot that a one-line one does not.
    var padT = small ? (panel.sub ? 32 : 18) : 14, padB = small ? 30 : 38;
    var pw = box.w - padL - padR, ph = box.h - padT - padB;
    var PX = function (r) { return box.x + padL + ((Math.log(r) - x0) / (x1 - x0 || 1)) * pw; };
    var PY = function (v) { return box.y + padT + (1 - (v - dom[0]) / (dom[1] - dom[0])) * ph; };
    var dp = spec.dp === undefined ? 2 : spec.dp;

    // horizontal gridlines + y labels, same weight and alpha as the trajectory panels.
    // When the zero rule is drawn, the middle gridline IS zero rather than the arithmetic
    // midpoint of the domain: otherwise the labelled line lands a percent or two off the
    // solid one and, rounded, reads as its label -- an asymmetric domain like [-22, 25]
    // put a "1" against the zero rule. Skipped when zero sits too near an end to label
    // without colliding with the endpoint, where the rule is next to a labelled value
    // anyway.
    // Where the caller fixed the scale (y0/y1), label THOSE values rather than the padded
    // extremes: a correlation axis running -1.2 to 1.2 names two values the statistic
    // cannot take. The padding stays in the drawing domain, so the series still clears the
    // panel edges -- only the labelled gridlines move inward.
    var tLo = (spec.y0 === null || spec.y0 === undefined) ? dom[0] : spec.y0;
    var tHi = (spec.y1 === null || spec.y1 === undefined) ? dom[1] : spec.y1;
    var mid = (tLo + tHi) / 2;
    var zeroInside = spec.zeroLine && dom[0] < 0 && dom[1] > 0;
    var zeroFrac = (0 - dom[0]) / (dom[1] - dom[0]);
    if (zeroInside && zeroFrac > 0.12 && zeroFrac < 0.88) mid = 0;
    ctx.strokeStyle = cssVar("--rule"); ctx.lineWidth = 1;
    ctx.font = MONO; ctx.fillStyle = cssVar("--ink-faint");
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    [tLo, mid, tHi].forEach(function (v) {
      var y = PY(v);
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(box.x + padL, y); ctx.lineTo(box.x + padL + pw, y); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(v.toFixed(dp), box.x + padL - 6, y);
    });

    // x ticks: every rho when there is room, otherwise thin them out
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    var step = pw / rhos.length < 22 ? (pw / rhos.length < 12 ? 3 : 2) : 1;
    rhos.forEach(function (r, i) {
      if (i % step && i !== rhos.length - 1) return;
      ctx.fillText(String(r), PX(r), box.y + padT + ph + 6);
    });

    // the zero rule, where zero is inside the range -- the sign change is the whole point,
    // so it is drawn loud (solid, reserved reference colour) like the trajectory zero line
    if (zeroInside) {
      ctx.strokeStyle = cssVar("--ref-line"); ctx.lineWidth = 1.75;
      ctx.beginPath(); ctx.moveTo(box.x + padL, PY(0)); ctx.lineTo(box.x + padL + pw, PY(0)); ctx.stroke();
    }
    // the shipped rho, dashed and faint -- a reference mark, not a datum
    if (spec.markRho) {
      ctx.save();
      ctx.strokeStyle = cssVar("--ink-faint"); ctx.lineWidth = 1.25; ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(PX(spec.markRho), box.y + padT); ctx.lineTo(PX(spec.markRho), box.y + padT + ph);
      ctx.stroke();
      ctx.restore();
      if (!small) {
        ctx.font = "9px ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif";
        ctx.fillStyle = cssVar("--ink-faint");
        ctx.textAlign = "right"; ctx.textBaseline = "top";
        ctx.fillText("shipped rho = " + spec.markRho, PX(spec.markRho) - 5, box.y + padT + 2);
      }
    }

    // the series
    ctx.strokeStyle = cssVar("--accent2"); ctx.lineWidth = 2;
    ctx.beginPath();
    var started = false;
    panel.values.forEach(function (v, i) {
      if (!finite(v)) { started = false; return; }
      if (started) ctx.lineTo(PX(rhos[i]), PY(v));
      else { ctx.moveTo(PX(rhos[i]), PY(v)); started = true; }
    });
    ctx.stroke();
    ctx.fillStyle = cssVar("--accent2");
    panel.values.forEach(function (v, i) {
      if (!finite(v)) return;
      ctx.beginPath(); ctx.arc(PX(rhos[i]), PY(v), small ? 2 : 2.8, 0, Math.PI * 2); ctx.fill();
    });

    // panel label (facets) and axis titles
    // Two lines: what the pairing IS on top, what it varied beneath it in muted type.
    // One line would run to ~33 characters for the ACL panels ("acl.12  Dell'a (wrong)
    // lambda x gamma_below") and overflow into the next facet at four columns.
    if (panel.label) {
      var sansFam = " ui-sans-serif, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.font = "600 " + (small ? "10px" : "11px") + sansFam;
      ctx.fillStyle = cssVar("--ink");
      ctx.fillText(panel.label, box.x + padL, box.y + padT - (panel.sub ? 19 : 6));
      if (panel.sub) {
        ctx.font = (small ? "9px" : "10px") + sansFam;
        ctx.fillStyle = cssVar("--ink-muted");
        ctx.fillText(panel.sub, box.x + padL, box.y + padT - 6);
      }
    }
    ctx.font = SANS; ctx.fillStyle = cssVar("--ink-muted");
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(spec.xlabel, box.x + padL + pw / 2, box.y + padT + ph + 19);
    if (!small) {
      ctx.save();
      ctx.translate(box.x + 12, box.y + padT + ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillText(spec.ylabel, 0, 0);
      ctx.restore();
    }
  }

  function drawFigure(canvas, spec) {
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(rect.width || 700, 460);
    var facets = spec.panels.length > 1;
    var cols = facets ? (w >= 760 ? 4 : 2) : 1;
    var rows = Math.ceil(spec.panels.length / cols);
    var ph = facets ? 164 : 250;   // +14 for the two-line facet label, so the plot area is unchanged
    var h = rows * ph + (facets ? 10 : 0);
    // Facets share one y scale, so the axis is named once for the whole figure in a left
    // gutter rather than repeated on every panel (where there is no room for it anyway).
    var gutter = facets ? 20 : 0;
    canvas.style.height = h + "px";
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var dom = domainOf(spec);
    var fw = (w - gutter) / cols;
    spec.panels.forEach(function (p, i) {
      var box = { x: gutter + (i % cols) * fw, y: Math.floor(i / cols) * ph, w: fw, h: ph };
      drawPanel(ctx, box, spec, p, dom, facets);
    });
    if (facets) {
      ctx.save();
      ctx.font = SANS; ctx.fillStyle = cssVar("--ink-muted");
      ctx.translate(12, h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillText(spec.ylabel, 0, 0);
      ctx.restore();
    }
  }

  // Composites title, subtitle, the canvas and a provenance footer onto an opaque
  // background at the canvas's own pixel ratio. A transparent PNG pasted into a light
  // document with a dark-theme figure in it is unreadable, which is why the background is
  // painted rather than left clear. No build date in the footer -- a figure outlives the
  // page it came from and a stale date on it is worse than none.
  function compose(canvas, spec) {
    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.width / dpr, chh = canvas.height / dpr;
    var pad = 14, titleH = 22, subH = spec.subtitle ? 16 : 0, footH = 16;
    var W = cw + pad * 2, H = pad + titleH + subH + chh + footH + pad;
    var out = document.createElement("canvas");
    out.width = Math.round(W * dpr); out.height = Math.round(H * dpr);
    var c = out.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = cssVar("--panel"); c.fillRect(0, 0, W, H);
    var font = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    var y = pad;
    c.textAlign = "left"; c.textBaseline = "top";
    c.fillStyle = cssVar("--ink"); c.font = "600 14px " + font;
    c.fillText(spec.title, pad, y); y += titleH;
    if (spec.subtitle) {
      c.fillStyle = cssVar("--ink-muted"); c.font = "11px " + font;
      c.fillText(spec.subtitle, pad, y); y += subH;
    }
    c.drawImage(canvas, 0, 0, canvas.width, canvas.height, pad, y, cw, chh);
    c.fillStyle = cssVar("--ink-muted"); c.font = "9px " + font;
    c.fillText(spec.foot, pad, H - pad - 9);
    return out;
  }

  var resetTimer = {};
  function flash(btn, cls, text) {
    var label = btn.querySelector("span");
    var was = btn.getAttribute("data-label") || label.textContent;
    btn.setAttribute("data-label", was);
    btn.classList.remove("is-done", "is-fail");
    btn.classList.add(cls);
    label.textContent = text;
    clearTimeout(resetTimer[btn.id || was]);
    resetTimer[btn.id || was] = setTimeout(function () {
      btn.classList.remove("is-done", "is-fail");
      label.textContent = was;
    }, 2200);
  }

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

  function figureBlob(canvas, spec) {
    return new Promise(function (resolve, reject) {
      compose(canvas, spec).toBlob(function (b) { b ? resolve(b) : reject(new Error("toBlob returned null")); }, "image/png");
    });
  }

  function wire() {
    Object.keys(FIGS).forEach(function (id) {
      var canvas = document.getElementById("fig-" + id);
      if (canvas) drawFigure(canvas, FIGS[id]);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".copy-btn[data-fig]"), function (btn) {
      btn.addEventListener("click", function () {
        var spec = FIGS[btn.getAttribute("data-fig")];
        var canvas = document.getElementById("fig-" + btn.getAttribute("data-fig"));
        if (!canvas || !canvas.width) { flash(btn, "is-fail", "Nothing drawn"); return; }
        if (btn.getAttribute("data-act") === "save") {
          figureBlob(canvas, spec).then(function (blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement("a");
            a.href = url; a.download = spec.file;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 0);
            flash(btn, "is-done", "Saved");
          }, function () { flash(btn, "is-fail", "Failed"); });
          return;
        }
        // ClipboardItem is handed the PROMISE, not an awaited blob: Safari drops the user
        // activation that authorises a clipboard write if you await anything first.
        if (!(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write)) {
          flash(btn, "is-fail", "Use Download"); return;
        }
        try {
          navigator.clipboard.write([new ClipboardItem({ "image/png": figureBlob(canvas, spec) })]).then(
            function () { flash(btn, "is-done", "Copied"); },
            function () { flash(btn, "is-fail", "Use Download"); });
        } catch (e) { flash(btn, "is-fail", "Use Download"); }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".copy-btn[data-tex]"), function (btn) {
      btn.addEventListener("click", function () {
        copyText(TEX[btn.getAttribute("data-tex")]).then(
          function () { flash(btn, "is-done", "Copied"); },
          function () { flash(btn, "is-fail", "Copy blocked"); });
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
  window.addEventListener("resize", function () {
    Object.keys(FIGS).forEach(function (id) {
      var canvas = document.getElementById("fig-" + id);
      if (canvas) drawFigure(canvas, FIGS[id]);
    });
  });
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      Object.keys(FIGS).forEach(function (id) {
        var canvas = document.getElementById("fig-" + id);
        if (canvas) drawFigure(canvas, FIGS[id]);
      });
    });
  }
})();
<\/script>`;
}

/* -------------------------------------- reports -------------------------------------- */
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

  const name = path.basename(configPath, ".json");
  const shipped = engine.CAPABILITY_RATIO;

  /* ---- figures ---- */
  const figs = {
    rankcorr: {
      title: "Rank correlation against the shipped \u03c1 \u2014 " + name,
      subtitle: "Spearman correlation of per-cell capability change vs \u03c1 = " + shipped
        + ". 1.0 means the ordering of cells is identical.",
      foot: "rho sensitivity \u00b7 " + name + " \u00b7 " + AXES.join(" \u00d7 ") + " \u00b7 "
        + cells.length + " cells \u00b7 " + REPS + " replicates \u00b7 t = " + AT,
      file: "rho-" + name + "-rankcorr.png",
      rhos: RHOS, markRho: shipped, zeroLine: true, y0: -1, y1: 1, dp: 1,
      ylabel: "rank correlation vs \u03c1 = " + shipped,
      xlabel: "\u03c1 (log scale)",
      panels: [{ label: null, values: rhoCorr.map((v) => (Number.isFinite(v) ? v : null)) }],
    },
    median: {
      title: "Median capability change \u2014 " + name,
      subtitle: "Median across cells of the change from the no-AI baseline, per cent, at each \u03c1.",
      foot: "rho sensitivity \u00b7 " + name + " \u00b7 " + AXES.join(" \u00d7 ") + " \u00b7 "
        + cells.length + " cells \u00b7 " + REPS + " replicates \u00b7 t = " + AT,
      file: "rho-" + name + "-median.png",
      rhos: RHOS, markRho: shipped, zeroLine: true, dp: 1,
      ylabel: "median capability change (%)",
      xlabel: "\u03c1 (log scale)",
      panels: [{ label: null, values: medians.map((v) => (Number.isFinite(v) ? v : null)) }],
    },
  };

  /* ---- tables ---- */
  const summaryRows = RHOS.map((r, q) => [
    String(r) + (r === shipped ? " *" : ""),
    (Math.log(r) / (1 - THETA)).toFixed(2),
    texNum(rhoCorr[q], 4),
    texNum(medians[q], 2),
  ]);
  const summaryTex = latexTable({
    caption: "Capability ratio sensitivity, " + texEscape(name) + ": rank correlation and median capability change by $\\rho$.",
    label: "tab:rho-" + name.replace(/[^A-Za-z0-9]/g, "-") + "-summary",
    align: "r r r r",
    header: ["$\\rho$", "$\\mathrm{d}\\ln w/\\mathrm{d}E$", "rank corr.\\ vs shipped", "median capability change (\\%)"],
    rows: summaryRows,
    note: "* the shipped capability ratio, and the reference the correlations are measured against.",
  });

  const cellTex = latexTable({
    caption: "Capability ratio sensitivity, " + texEscape(name)
      + ": per-cell capability change (\\%) at each $\\rho$, with the $\\rho$ at which each cell crosses zero.",
    label: "tab:rho-" + name.replace(/[^A-Za-z0-9]/g, "-") + "-cells",
    align: AXES.map(() => "r").join(" ") + " r " + RHOS.map(() => "r").join(" ") + " r",
    header: AXES.map((a) => texEscape(a)).concat(["$\\Delta\\overline{E}$"])
      .concat(RHOS.map((r) => String(r))).concat(["crossover $\\rho$"]),
    rows: cells.map((c, i) => AXES.map((a) => String(c.combo[a]))
      .concat([dE[i].toFixed(4)])
      .concat(RHOS.map((_, q) => texNum(changes[q][i], 2)))
      .concat([cellCross[i] === null ? "n/a" : String(Math.round(cellCross[i]))])),
  });
  const texById = { summary: summaryTex, cells: cellTex };
  fs.writeFileSync(path.join(OUT, "rho_summary_table.tex"), summaryTex);
  fs.writeFileSync(path.join(OUT, "rho_cells_table.tex"), cellTex);

  const summaryHtml = `<table class="data-table"><thead>
<tr><th>&rho;</th><th>slope d ln w/dE</th><th>rank corr. vs shipped</th><th>median capability change (%)</th></tr>
</thead><tbody>
${RHOS.map((r, q) => `<tr${r === shipped ? ' class="ref"' : ""}><td>${r}${r === shipped ? " *" : ""}</td>`
    + `<td>${(Math.log(r) / (1 - THETA)).toFixed(2)}</td>`
    + `<td>${Number.isFinite(rhoCorr[q]) ? rhoCorr[q].toFixed(4) : "—"}</td>`
    + `<td class="${Number.isFinite(medians[q]) && medians[q] < 0 ? "neg" : ""}">${Number.isFinite(medians[q]) ? medians[q].toFixed(2) : "—"}</td></tr>`).join("\n")}
</tbody></table>`;

  const cellsHtml = `<table class="data-table"><thead>
<tr>${AXES.map((a) => `<th>${esc(a)}</th>`).join("")}<th>&Delta;meanE</th>${RHOS.map((r) => `<th>${r}</th>`).join("")}<th>crossover &rho;</th></tr>
</thead><tbody>
${cells.map((c, i) => "<tr>" + AXES.map((a) => `<td>${esc(c.combo[a])}</td>`).join("")
    + `<td>${dE[i].toFixed(4)}</td>`
    + RHOS.map((_, q) => {
      const v = changes[q][i];
      return `<td class="${Number.isFinite(v) && v < 0 ? "neg" : ""}">${Number.isFinite(v) ? v.toFixed(2) : "—"}</td>`;
    }).join("")
    + `<td>${cellCross[i] === null ? "—" : Math.round(cellCross[i])}</td></tr>`).join("\n")}
</tbody></table>`;

  writeReportPage({ name, nCells: cells.length, medCross, flipped, figs, texById, summaryHtml, cellsHtml });
}

function writeReportPage(o) {
  const shipped = engine.CAPABILITY_RATIO;
  const body = `
<div class="panel">
  <div class="head"><h1>Capability ratio sensitivity &mdash; ${esc(o.name)}</h1></div>
  <p>How much of the capability result is the assumed constant &rho;? The capability weight is
  w(E) = &rho;<sup>(E&minus;&theta;)/(1&minus;&theta;)</sup> with &theta; = ${THETA}, so &rho; asserts
  that one person at the ceiling is worth &rho; people at the expert threshold. Neither constant is
  measured against anything external: &theta; was chosen as a robustness midpoint, and that argument
  was made under the legacy calibration rather than the world-model regime these experiments run in.
  &rho; has never had an argument of either kind &mdash; it is a stated assumption that appears in
  engine.js and nowhere else. It affects reported output only, never the update, so one set of runs
  yields every &rho; here.</p>
  <p class="facts">config: ${esc(path.basename(configPath))} &middot; axes: ${AXES.map(esc).join(" x ")}
  &middot; ${o.nCells} cells (stride ${STRIDE}) &middot; ${REPS} replicates &middot; t = ${AT}
  &middot; ${RHOS.length} values of &rho; &middot; <a href="../index.html">all experiments</a></p>
</div>

${figureBlock("rankcorr", "Rank correlation of per-cell capability change against the shipped &rho;. 1.0 means the ordering of cells is identical; the dashed line marks &rho; = " + shipped + ", where the correlation is 1 by construction.", 250)}

${figureBlock("median", "Median capability change, per cent. The solid rule is zero: where the curve crosses it, AI stops reading as a gain and starts reading as a loss.", 250)}

${tableBlock("summary", "Summary", "one row per &rho;", o.summaryHtml,
    "* the shipped CAPABILITY_RATIO, and the reference the correlations are measured against.")}

<div class="panel">
  <div class="head"><h2>Reading this</h2></div>
  <div class="key">
    <p>Two different questions, and they have different answers.</p>
    <p style="margin-top:.6rem"><b>Does &rho; reorder the cells?</b> That is the rank correlation.
    Where it is 1.000 every comparative claim &mdash; &ldquo;this condition is worse than that
    one&rdquo; &mdash; is independent of the assumption. Where it is not, the reported ordering
    holds only at the &rho; that produced it.</p>
    <p style="margin-top:.6rem"><b>Does &rho; set the sign?</b> That is the crossover column. A
    natural guess is that &rho; only rescales, because capability change would then be
    exp(k&middot;&Delta;E) &minus; 1 with k = ln&rho;/(1&minus;&theta;). That holds only when a
    condition shifts the whole expertise distribution uniformly. In general
    C = &sum;<sub>i</sub> w(E<sub>i</sub>)&#8467;(E<sub>i</sub>) is a sum over the population and
    &rho; decides <em>which part of it dominates</em>: at low &rho; the weight is nearly flat and C
    behaves like a headcount, so the AI leverage term &#8467; drives the result; at high &rho;
    almost all of C sits in the top tail, and the result is whatever happened to the best few per
    cent. A cell whose crossover falls inside the swept range reports a capability <em>gain</em>
    below it and a <em>loss</em> above it.</p>
    <p style="margin-top:.6rem"><b>Here: ${o.flipped} of ${o.nCells} cells change sign</b> within
    &rho; = ${RHOS[0]}&ndash;${RHOS[RHOS.length - 1]}${o.medCross
    ? `, and the median cell crosses at &rho; &asymp; ${Math.round(o.medCross)}`
    : ", and the median cell does not cross"}.</p>
  </div>
</div>

${tableBlock("cells", "Per cell", "capability change (%) at each &rho;", o.cellsHtml,
    "&Delta;meanE is the same cell&rsquo;s expertise change &mdash; the quantity that does not depend on &rho; at all. The last column is the &rho; at which that cell&rsquo;s capability change crosses zero.")}
`;
  fs.writeFileSync(path.join(OUT, "rho_report.html"),
    page("Capability ratio sensitivity — " + o.name, body, clientScript(o.figs, o.texById)));
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
  const shipped = runs[0].shippedRho;
  const num = (v) => (Number.isFinite(v) ? v : null);

  // Facet labels: "exp.25  λ × γ_below" rather than the bare directory name. The prefix
  // says which set the pairing came from and the symbols say what was varied, so a reader
  // can take a panel at face value instead of cross-referencing the table below it. Same
  // glyphs report.template.html's SYMBOL map uses, so a figure lifted from here sits
  // beside one lifted from the main reports without a change of notation.
  const SHORT_SET = { experiment: "exp", structure: "str", recruitment: "rec", acl: "acl" };
  const SYMBOL = {
    aiLevelFraction: "λ", aiDampeningBelow: "γ_below", aiDampeningAbove: "γ_above",
    transferRate: "β", decayRate: "δ", turnoverRate: "r",
    M: "M", graphAttachment: "m", frontierBreadth: "b",
    recruitmentFraction: "f_hire", recruitmentShockYears: "Y_freeze",
    expertiseMean: "μ_E", entrantExpertiseMean: "μ_ent",
  };
  // The three ACL pairings all sweep the same axes — what separates them is the
  // Dell'Acqua capability variant — so naming them by axes would print three identical
  // labels. They are named by variant instead. Read from the ACL manifest rather than
  // hardcoded: the variant/number mapping is generated, and pinning it here would drift
  // the first time the set is regenerated.
  const aclVariant = {};
  try {
    const am = JSON.parse(fs.readFileSync(paths.data("experiments.acl.manifest.json"), "utf8"));
    const SHORT_VARIANT = { published: "pub", weak: "weak", wrong: "wrong" };
    (am.experiments || []).forEach((e) => {
      if (e.variant) aclVariant["acl." + e.n] = SHORT_VARIANT[e.variant] || e.variant;
    });
  } catch (e) { /* no ACL manifest here — fall back to the generic set.n + axes label */ }

  // {label, sub}: the pairing's name on the first line, the axes it swept on the second.
  const panelLabel = (r) => {
    const dot = r.dir.indexOf(".");
    const set = dot < 0 ? r.dir : r.dir.slice(0, dot);
    const rest = dot < 0 ? "" : r.dir.slice(dot);
    const short = (SHORT_SET[set] || set) + rest;
    return {
      label: aclVariant[r.dir] ? short + "  Dell'a (" + aclVariant[r.dir] + ")" : short,
      sub: r.axes.map((a) => SYMBOL[a] || a).join(" × "),
    };
  };

  // Faceted rather than overlaid. Eight series on one pair of axes needs eight
  // categorical hues, and eight hues cannot be separated well enough to read: the best
  // arrangement this study could find still put two of them at dE 7.1 for NORMAL colour
  // vision, against a floor of 15. Small multiples drop the problem entirely, share one
  // y-scale so the curves stay comparable, and export as a single figure.
  const figs = {};
  if (same) {
    figs.rankcorr = {
      title: "Rank correlation against the shipped \u03c1, by experiment",
      subtitle: "Spearman correlation of per-cell capability change vs \u03c1 = " + shipped
        + ", shared scale. 1.0 means the ordering of cells is unchanged.",
      foot: "rho sensitivity \u00b7 " + runs.length + " experiments \u00b7 "
        + runs[0].replicates + " replicates \u00b7 \u03c1 = " + grid[0] + "\u2013" + grid[grid.length - 1],
      file: "rho-rankcorr-by-experiment.png",
      rhos: grid, markRho: shipped, zeroLine: true, y0: -1, y1: 1, dp: 1,
      ylabel: "rank correlation", xlabel: "\u03c1 (log scale)",
      panels: runs.map((r) => Object.assign(panelLabel(r), { values: r.rankCorr.map(num) })),
    };
    figs.median = {
      title: "Median capability change, by experiment",
      subtitle: "Median across cells of the change from the no-AI baseline, per cent, shared scale.",
      foot: "rho sensitivity \u00b7 " + runs.length + " experiments \u00b7 "
        + runs[0].replicates + " replicates \u00b7 \u03c1 = " + grid[0] + "\u2013" + grid[grid.length - 1],
      file: "rho-median-by-experiment.png",
      rhos: grid, markRho: shipped, zeroLine: true, dp: 0,
      ylabel: "median change (%)", xlabel: "\u03c1 (log scale)",
      panels: runs.map((r) => Object.assign(panelLabel(r), { values: r.medianChange.map(num) })),
    };
  }

  /* ---- the low-rho correlation table ---- */
  // The interesting region: the correlation curve does most of its moving in the first
  // few steps, so the headline table's single "corr at the bottom of the range" number
  // hides the shape. These are the columns that show whether a config settles quickly or
  // stays reordered well past any defensible rho.
  const LOW = grid.filter((r) => r <= 8);
  const lowRows = runs.map((r) => [r.dir].concat(LOW.map((k) => {
    const i = r.rhos.indexOf(k);
    return i < 0 ? null : num(r.rankCorr[i]);
  })));

  const lowTex = latexTable({
    caption: "Rank correlation of per-cell capability change against the shipped $\\rho="
      + shipped + "$, at low $\\rho$.",
    label: "tab:rho-low-correlation",
    align: "l " + LOW.map(() => "r").join(" "),
    header: ["experiment"].concat(LOW.map((r) => "$\\rho=" + r + "$")),
    rows: lowRows.map((row) => [texEscape(row[0])].concat(row.slice(1).map((v) => texNum(v, 3)))),
    note: "A correlation of 1 would mean the ordering of cells is identical to the ordering at the shipped $\\rho$; "
      + "0 means unrelated; negative means the ordering is inverted. \\emph{n/a} marks a $\\rho$ at which the series "
      + "has no variance to rank.",
  });

  const expTex = latexTable({
    caption: "Capability ratio sensitivity across the study: one representative pairing per experiment set.",
    label: "tab:rho-experiments",
    align: "l l r r r r r r",
    header: ["experiment", "axes", "cells", "reps", "$t$", "corr.\\ at $\\rho=" + grid[0] + "$",
      "median change at shipped $\\rho$ (\\%)", "cells changing sign"],
    rows: runs.map((r) => {
      const q = r.rhos.indexOf(r.shippedRho);
      return [texEscape(r.dir), texEscape(r.axes.join(" x ")), String(r.cells), String(r.replicates),
        String(r.tick), texNum(num(r.rankCorr[0]), 3), texNum(num(r.medianChange[q]), 2),
        r.cellsFlippingSign + " / " + r.cells];
    }),
  });
  const texById = { low: lowTex, experiments: expTex };
  fs.writeFileSync(path.join(root, "rho_low_correlation_table.tex"), lowTex);
  fs.writeFileSync(path.join(root, "rho_experiments_table.tex"), expTex);

  const lowHtml = `<table class="data-table"><thead>
<tr><th>experiment</th>${LOW.map((r) => `<th>&rho;=${r}</th>`).join("")}</tr>
</thead><tbody>
${lowRows.map((row) => "<tr><td>" + esc(row[0]) + "</td>"
    + row.slice(1).map((v) => `<td class="${Number.isFinite(v) && v < 0 ? "neg" : ""}">${Number.isFinite(v) ? v.toFixed(3) : "—"}</td>`).join("")
    + "</tr>").join("\n")}
</tbody></table>`;

  const expHtml = `<table class="data-table"><thead>
<tr><th>experiment</th><th>axes</th><th>cells</th><th>reps</th><th>t</th>
<th>corr. at &rho;=${grid[0]}</th><th>median change at shipped &rho; (%)</th>
<th>cells changing sign</th><th>median crossover &rho;</th></tr>
</thead><tbody>
${runs.map((r) => {
    const q = r.rhos.indexOf(r.shippedRho);
    const corr = Number.isFinite(r.rankCorr[0]) ? r.rankCorr[0].toFixed(3) : "—";
    const change = Number.isFinite(r.medianChange[q]) ? r.medianChange[q].toFixed(2) : "—";
    return `<tr><td><a href="${esc(r.dir)}/rho_report.html">${esc(r.dir)}</a></td>`
      + `<td>${r.axes.map(esc).join(" x ")}</td><td>${r.cells}</td><td>${r.replicates}</td>`
      + `<td>${r.tick}</td><td class="${Number.isFinite(r.rankCorr[0]) && r.rankCorr[0] < 0 ? "neg" : ""}">${corr}</td>`
      + `<td class="${Number.isFinite(r.medianChange[q]) && r.medianChange[q] < 0 ? "neg" : ""}">${change}</td>`
      + `<td>${r.cellsFlippingSign} / ${r.cells}</td>`
      + `<td>${r.medianCrossover ? Math.round(r.medianCrossover) : "—"}</td></tr>`;
  }).join("\n")}
</tbody></table>`;

  const body = `
<div class="panel">
  <div class="head"><h1>Capability ratio sensitivity</h1></div>
  <p class="facts">${runs.length} experiments &middot; ${runs[0].replicates} replicates &middot;
  ${grid.length} values of &rho; (${grid[0]}&ndash;${grid[grid.length - 1]}) &middot; shipped &rho; = ${shipped}</p>
</div>

${same ? figureBlock("rankcorr", "One panel per experiment, shared scale. The dashed line marks the shipped &rho;, where the correlation is 1 by construction; the solid rule is zero.", 320)
    : `<div class="panel"><p class="facts">experiments were swept over different &rho; grids, so the curves are not shown together; open the individual reports below.</p></div>`}

${same ? figureBlock("median", "One panel per experiment, shared scale. The solid rule is zero: where a curve crosses it, AI stops reading as a capability gain and starts reading as a loss.", 320) : ""}

${tableBlock("low", "Rank correlation at low &rho;", "vs the shipped &rho; = " + shipped, lowHtml,
    "1.000 means the ordering of cells is identical to the shipped &rho;; 0 means unrelated; negative means inverted. &ldquo;&mdash;&rdquo; marks a &rho; at which the series has no variance to rank.")}

<div class="panel">
  <div class="head"><h2>What these correlations are telling us</h2></div>
  <div class="key">
    <p>The correlation answers one specific question: <b>when a report says &ldquo;condition A
    produced a bigger capability loss than condition B&rdquo;, does that claim survive if &rho;
    were smaller than ${shipped} &mdash; or was it only ever true <em>because</em> &rho; = ${shipped}
    weights the top of the distribution so heavily?</b></p>
    <p style="margin-top:.6rem">That is narrower than &ldquo;does &rho; matter&rdquo;. The
    magnitudes plainly move: the median change shifts by double digits across the sweep.
    Correlation is blind to magnitude &mdash; it asks only whether the <em>order</em> of cells is
    preserved. A config can have a wildly &rho;-sensitive effect size and a rock-solid ranking.</p>
    <p style="margin-top:.6rem"><b>Where it is high</b> the comparative claims rest on the
    mechanism, not the assumption: whatever is said about &ldquo;this cell beats that cell&rdquo;
    would still hold at &rho; = 8 instead of ${shipped}.</p>
    <p style="margin-top:.6rem"><b>Where it is low or negative</b> the ranking itself is contingent
    on &rho;. That is stronger than &ldquo;the numbers are noisy&rdquo;: a negative correlation
    means the ordering <em>reverses</em>, so the cell that looks worst at the shipped &rho; is
    close to the one that looked best at the bottom of the range. Any claim of the form
    &ldquo;X is most damaging when Y&rdquo; drawn from such a set needs stating as a claim about
    &rho; = ${shipped} specifically, not about the mechanism.</p>
    <p style="margin-top:.6rem"><b>Why the split falls where it does.</b> Pairings that act by
    shifting the <em>whole</em> expertise distribution &mdash; dampening, or reshaping peer pools
    through M &mdash; move everyone&rsquo;s E together, so reweighting the sum by &rho; mostly
    rescales and the ranking survives. The assisted-learning pairings encode a leverage term that
    treats different <em>bands</em> of the distribution asymmetrically, by where each person sits
    relative to the AI&rsquo;s level. Which cell &ldquo;wins&rdquo; then depends on exactly where
    &rho; concentrates the sum, and that is a different question cell by cell &mdash; which is why
    the ordering can invert rather than merely rescale.</p>
  </div>
</div>

${tableBlock("experiments", "Experiments", "one representative pairing per set", expHtml,
    "Each row links to that experiment&rsquo;s own report, with the full per-cell breakdown.")}
`;
  fs.writeFileSync(path.join(root, "index.html"),
    page("Capability ratio sensitivity", body, clientScript(figs, texById)));
  console.log(`[rho] wrote ${path.relative(paths.ROOT, root)}/index.html  (${runs.length} experiment(s))`);
}
