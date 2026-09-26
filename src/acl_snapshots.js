#!/usr/bin/env node
// Expertise snapshots: the per-person E array at the reported tick, written to disk.
//
//   node src/acl_snapshots.js --config data/experiments-acl/acl.1.json [options]
//
// WHY THIS EXISTS. acl_leverage_sweep.js asks where in (g_n, g_x, d_n, rho) space AI is a
// net gain in capability. Capability is
//
//   C = sum_i w(E_i) l(E_i),   w(E) = rho^((E - theta)/(1 - theta)),
//   l(E) = F*alpha(E) + (1 - F)*beta(E)   (engine.js aclLeverage)
//
// and NONE of rho, g_n (aclNoviceGain), g_x (aclExpertGain) or d_n (aclNoviceDeficit)
// appears anywhere in tick(): they are read out of the E array, they never steer it (see
// assertOutputOnly below, which checks this rather than trusting it). So one simulation
// pass serves EVERY combination of the four — but only if the E array survives the run.
//
// It currently does not. results/*.csv and results/rho/*/rho_runs.csv hold scalar
// summaries — meanE, percentiles, shareExpert, and capability already collapsed at one
// (rho, g_n, g_x, d_n). C is a sum over the whole population and no set of summary
// statistics recovers it. Hence this script: run each cell once, keep the population.
//
// Cells, seeds and arms are built EXACTLY as rho_sensitivity.js builds them — same
// formula, same order — so a cell here is the same cell there, and the sweep's numbers
// can be checked against results/rho/<config>/rho_summary.json cell for cell.
//
// Options:
//   --config PATH      experiment JSON, as in data/experiments-acl/ (required)
//   --stride N         take every Nth grid value on each axis (default 1 = the full grid)
//   --replicates N     replicates per cell (default: the config's own count)
//   --at TICK          which recorded tick to snapshot (default: the last one)
//   --out DIR          default results/acl-leverage/<config basename>
//   --workers N        default: CPU count - 1
//
// Output (two files, and nothing derived — deriving is the sweep's job):
//   expertise.f32   every run's E array, Float32, concatenated in run-id order
//   snapshots.json  the index: one record per run, with its offset into expertise.f32
//
// Float32 is deliberate. E is a number in [0,1] carried to ~7 significant figures; the
// capability sum spans orders of magnitude but is dominated by the top of the
// distribution, where Float32 still resolves E to ~1e-7 — far finer than the
// replicate-to-replicate spread the sweep averages over. The saving is real: 11,322
// people x 360 runs is 16 MB rather than 32, and a full ACL family fits in memory.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const engine = require("./engine.js");
const { loadWorldModel } = require("./world_model.js");
const paths = require("./paths.js");

// The sweep's entire economy rests on this: the leverage parameters and rho are read out
// of a run, never fed back into it. Verified rather than assumed — two runs from the same
// seed whose ONLY difference is the four output parameters must end with identical E. If
// a future edit lets capability steer careers, every cell of the sweep would silently
// become a different experiment per parameter point, and a wrong answer is worse than no
// answer.
function assertOutputOnly() {
  const base = { N: 200, M: 10, seed: 5, aiEnabled: true, aiLevelFraction: 0.6 };
  const a = engine.initSim(Object.assign({}, base,
    { aclNoviceGain: 0.43, aclExpertGain: 0.17, aclNoviceDeficit: 0.19 }));
  const b = engine.initSim(Object.assign({}, base,
    { aclNoviceGain: 0.90, aclExpertGain: 0.00, aclNoviceDeficit: 0.80 }));
  for (let t = 0; t < 60; t++) {
    engine.tick(a);
    engine.tick(b);
    engine.institutionStats(b);        // the capability-computing path, run extra
  }
  for (let i = 0; i < a.N; i++) {
    if (a.E[i] !== b.E[i]) {
      console.error("[snap] the leverage parameters now perturb the trajectory of E.");
      console.error("  One snapshot can no longer serve every (g_n, g_x, d_n, rho): each");
      console.error("  point would need its own simulation. That assumption is what this");
      console.error("  script and acl_leverage_sweep.js are built on, so stopping here.");
      process.exit(1);
    }
  }
}

/* ------------------------------------ job running ------------------------------------ */
// One run, kept only at the snapshot tick. Nothing is computed from E here: the point of
// the file is that the population leaves the worker intact.
function runJob(job, wm) {
  const params = Object.assign({}, job.params);
  if (params.graphSource === "worldModel") params.worldModel = wm;
  params.seed = job.seed;
  const s = engine.initSim(params);
  for (let t = 1; t <= job.at; t++) engine.tick(s);
  let sumE = 0;
  for (let i = 0; i < s.N; i++) sumE += s.E[i];
  const E = new Float32Array(s.E);          // Float64Array -> Float32Array, copied
  return {
    id: job.id, n: s.N, meanE: sumE / s.N,
    startTopE: s.startTopE,
    // The AI's absolute level for this run, which l(E) is keyed to. Depends on
    // startTopE, which is a property of the run's own t=0 draw, so it has to travel
    // with the snapshot rather than be recomputed from the config.
    aiLevel: params.aiEnabled ? params.aiLevelFraction * s.startTopE : null,
    E,
  };
}

if (!isMainThread) {
  const { wmSpec } = workerData;
  let wm = null;
  if (wmSpec) {
    wm = loadWorldModel(
      JSON.parse(fs.readFileSync(path.resolve(paths.DATA, wmSpec.worldModelPath), "utf8")),
      JSON.parse(fs.readFileSync(path.resolve(paths.DATA, wmSpec.mobilityCostsPath), "utf8")),
      wmSpec.worldModelOptions || {});
  }
  parentPort.on("message", (job) => {
    if (job === null) return process.exit(0);
    const r = runJob(job, wm);
    // Transferred, not cloned: 45 KB per run, and the worker has no further use for it.
    parentPort.postMessage(r, [r.E.buffer]);
  });
  return;
}

/* --------------------------------------- main ---------------------------------------- */
function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
function intArg(name, def) {
  const raw = arg(name, String(def));
  const v = parseInt(raw, 10);
  if (!Number.isInteger(v) || v < 1) {
    console.error(`[snap] --${name} must be an integer >= 1, got "${raw}"`);
    process.exit(1);
  }
  return v;
}

const configPath = arg("config");
if (!configPath) {
  console.error("usage: node src/acl_snapshots.js --config data/experiments-acl/acl.1.json");
  console.error("                                 [--stride 1] [--replicates N] [--at TICK] [--out DIR] [--workers N]");
  process.exit(1);
}
assertOutputOnly();

const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (cfg.mode && cfg.mode !== "grid") {
  console.error(`[snap] only grid configs are supported; ${configPath} is mode "${cfg.mode}"`);
  process.exit(1);
}

// Axes, subsampling and combo order: character for character what rho_sensitivity.js
// does, so comboIndex means the same thing in both sets of output. Default stride is 1
// rather than that script's 4 — the ACL grids are 18 cells, small enough to take whole,
// and a subsampled snapshot cannot be compared against a full-grid rho report.
const AXES = Object.keys(cfg.params);
const STRIDE = intArg("stride", 1);
const axisValues = AXES.map((k) => {
  const v = cfg.params[k].values;
  if (!v) { console.error(`[snap] axis ${k} has no "values" — ranges are not supported here`); process.exit(1); }
  const out = v.filter((_, i) => i % STRIDE === 0);
  if (out[out.length - 1] !== v[v.length - 1]) out.push(v[v.length - 1]);
  return out;
});
const combos = axisValues.reduce((acc, vals, ax) =>
  acc.flatMap((c) => vals.map((v) => Object.assign({}, c, { [AXES[ax]]: v }))), [{}]);

const RECORD_AT = cfg.recordAt && cfg.recordAt.length ? cfg.recordAt : [cfg.horizon];
const AT = intArg("at", RECORD_AT[RECORD_AT.length - 1]);
if (!RECORD_AT.includes(AT)) {
  console.error(`[snap] --at ${AT} is not a recorded tick of ${path.basename(configPath)}`);
  process.exit(1);
}
// Defaults to the config's own replicate count, unlike rho_sensitivity.js which defaults
// to 3. A snapshot is written once and swept many times, so its cost is amortised and
// there is no reason to take fewer replicates than the published experiment took.
const REPS = intArg("replicates", cfg.replicates || 1);
const OUT = arg("out", path.join(paths.RESULTS, "acl-leverage", path.basename(configPath, ".json")));
const WORKERS = Math.max(1, intArg("workers", Math.max(1, os.cpus().length - 1)));

const jobs = [];
combos.forEach((combo, ci) => {
  for (let r = 0; r < REPS; r++) {
    // Same seed formula as rho_sensitivity.js and batch_run.js. Identical seeds mean
    // identical careers, which is what makes the sweep checkable against the published
    // rho report rather than merely similar to it.
    const seed = (cfg.seed || 1) + ci * 1000 + r;
    const base = Object.assign({}, cfg.fixed, combo);
    if (cfg.pairWithBaseline) {
      jobs.push({ comboIndex: ci, combo, arm: "treatment", replicate: r, seed, at: AT,
        params: Object.assign({}, base, { aiEnabled: true }) });
      // baselineParams applied AFTER aiEnabled:false, the order batch_run.js and
      // rho_sensitivity.js both use, so a config cannot re-enable AI in the reference arm.
      jobs.push({ comboIndex: ci, combo, arm: "baseline", replicate: r, seed, at: AT,
        params: Object.assign({}, base, { aiEnabled: false }, cfg.baselineParams || {}) });
    } else {
      jobs.push({ comboIndex: ci, combo, arm: "single", replicate: r, seed, at: AT, params: base });
    }
  }
});
jobs.forEach((j, i) => { j.id = i; });

console.log(`[snap] ${path.basename(configPath)}: ${AXES.join(" x ")}`);
console.log(`[snap] ${combos.length} cell(s) (stride ${STRIDE}) x ${REPS} replicate(s)`
  + `${cfg.pairWithBaseline ? " x 2 arms" : ""} = ${jobs.length} run(s), snapshot at tick ${AT}`);
console.log(`[snap] every (g_n, g_x, d_n, rho) is read off these snapshots afterwards — no run is repeated per parameter point`);

const snaps = new Array(jobs.length);
let issued = 0, done = 0;
const t0 = Date.now();
const pool = [];
for (let w = 0; w < Math.min(WORKERS, jobs.length); w++) {
  const worker = new Worker(__filename, { workerData: { wmSpec: cfg.worldModel || null } });
  pool.push(worker);
  worker.on("message", (msg) => {
    snaps[msg.id] = msg;
    if (++done % 25 === 0 || done === jobs.length) {
      const el = (Date.now() - t0) / 1000;
      const eta = done < jobs.length ? `, ~${((el / done) * (jobs.length - done)).toFixed(0)}s left` : "";
      console.log(`[snap] ${done}/${jobs.length} runs (${el.toFixed(0)}s${eta})`);
    }
    if (issued < jobs.length) worker.postMessage(jobs[issued++]);
    else { worker.postMessage(null); if (done === jobs.length) finish(); }
  });
  worker.on("error", (e) => { console.error("[snap] worker failed:", e); process.exit(1); });
  worker.postMessage(jobs[issued++]);
}

function finish() {
  fs.mkdirSync(OUT, { recursive: true });
  const binPath = path.join(OUT, "expertise.f32");

  // Written run by run in id order, so snapshots.json's offsets are exactly the order
  // the jobs were built in — not the order the workers happened to finish.
  const fd = fs.openSync(binPath, "w");
  let offset = 0;
  const records = jobs.map((j) => {
    const s = snaps[j.id];
    fs.writeSync(fd, Buffer.from(s.E.buffer, s.E.byteOffset, s.E.byteLength));
    const rec = {
      id: j.id, comboIndex: j.comboIndex, combo: j.combo, arm: j.arm,
      replicate: j.replicate, seed: j.seed,
      offset, n: s.n, meanE: s.meanE, startTopE: s.startTopE, aiLevel: s.aiLevel,
    };
    offset += s.n;
    return rec;
  });
  fs.closeSync(fd);

  const p = Object.assign({}, engine.DEFAULT_PARAMS, cfg.fixed);
  const index = {
    config: path.basename(configPath),
    configPath: path.relative(paths.ROOT, path.resolve(configPath)),
    axes: AXES, axisValues, stride: STRIDE, cells: combos.length,
    replicates: REPS, arms: cfg.pairWithBaseline ? ["treatment", "baseline"] : ["single"],
    tick: AT, horizon: cfg.horizon,
    theta: engine.EXPERT_THRESHOLD,
    // The two leverage parameters the sweep does NOT vary, and the shipped values of the
    // three it does. A sweep read against a snapshot taken under a different frontier
    // shape would be comparing two different models, so both are recorded here and
    // checked by the sweep.
    frontierBreadth: p.frontierBreadth,
    aclBlendSharpness: p.aclBlendSharpness,
    shipped: { g_n: p.aclNoviceGain, g_x: p.aclExpertGain, d_n: p.aclNoviceDeficit },
    shippedRho: engine.CAPABILITY_RATIO,
    dtype: "float32", values: offset,
    expertiseFile: "expertise.f32",
    generated: new Date().toISOString().slice(0, 10),
    runs: records,
  };
  fs.writeFileSync(path.join(OUT, "snapshots.json"), JSON.stringify(index, null, 1));

  const mb = (offset * 4 / 1e6).toFixed(1);
  const rel = path.relative(paths.ROOT, OUT);
  console.log(`\n[snap] wrote ${rel}/expertise.f32   (${jobs.length} runs, ${offset.toLocaleString()} people, ${mb} MB)`);
  console.log(`[snap] wrote ${rel}/snapshots.json`);
  console.log(`[snap] next: node src/acl_leverage_sweep.js --snapshots ${rel}`);
  pool.forEach((w) => w.terminate());
}
