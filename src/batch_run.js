#!/usr/bin/env node
// Batch runner for the capability-decay engine — sweeps a parameter space
// across many simulation runs and writes per-run + summarized CSVs.
//
// Usage:
//   node src/batch_run.js --config data/sweep.json [--out results.csv] [--summary-out results_summary.csv]
//                      [--workers N] [--no-raw] [--dry-run]
//   node src/batch_run.js --config data/sweep.json --from-results results.csv --no-raw
//
// Config file (JSON) shape:
//   {
//     "mode": "grid" | "random",        // default "grid"
//     "runs": 500,                      // required when mode is "random": number of param draws
//     "replicates": 3,                  // default 1 — repeated runs per param combo, distinct seeds
//     "horizon": 500,                   // required — ticks to simulate (up to the last recordAt)
//     "recordAt": [100, 300, 500],      // default [horizon] — ticks to write a row for
//     "seed": 1,                        // default 1 — base seed; the whole sweep is reproducible from this
//     "fixed": { "N": 500, "M": 40 },   // params held constant across every run
//     "pairWithBaseline": true,         // default false — see below
//     "baselineParams": { "recruitmentShockYears": 0 },  // optional — see below
//     "params": {                       // params being swept — any key from engine.js DEFAULT_PARAMS
//       "aiDampeningBelow": { "range": [0, 2], "steps": 5 },
//       "aiLevelFraction": { "range": [0.4, 0.9], "steps": 4 },   // grid mode: linspace, inclusive
//       "turnoverRate": { "range": [0, 1] }                       // random mode: continuous uniform draw
//     }
//   }
//
// Grid mode runs the full Cartesian product of every "params" axis x replicates.
// Random mode independently draws each param for "runs" param-combinations x replicates.
//
// "pairWithBaseline": for every combo, also runs a same-seed aiEnabled:false twin
// (an "arm" column marks "baseline" vs "treatment"). Don't put aiEnabled in params/fixed
// when using this — it's set automatically per arm. Doubles the run count, but a matched
// seed per pair is what makes the comparison valid: it controls for the randomness the two
// arms share, isolating what AI actually changed. This is how you measure expertise
// *obliterated by AI* rather than a raw AI-on number that means nothing on its own — see
// the auto-generated *_shortfall.csv, which is the point of this mode.
// "baselineParams": extra parameters forced in the BASELINE arm only, on top of
// aiEnabled:false. Without it the reference is "the same world without AI", which is the
// right question for the AI sweeps. The recruitment set asks a different one — what AI
// AND a hiring freeze cost together, against a world with neither — and that needs the
// freeze switched off in the reference as well. The seed is still shared, so the arms
// start from the same population; they will diverge in their random stream once the
// override changes how many draws a tick takes, which is why such a set carries more
// replicate noise than one whose arms differ only in a multiplier.
//
// Refused if it names aiEnabled (the baseline is the no-AI arm by definition) or a
// parameter that config.params also sweeps (the baseline would be identical across that
// axis, and the sweep would measure nothing while still drawing a plausible heatmap).
//
// See sweep.example.json and sweep.random.example.json for complete examples.

"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { initSim, tick, mulberry32, DEFAULT_PARAMS } = require(path.join(__dirname, "engine.js"));
const paths = require("./paths.js");
const { BatchOutput, readResultRows } = require("./batch_output.js");

const METRIC_KEYS = ["meanE", "p10E", "p50E", "p90E", "divergence", "topE", "aiLevel", "shareBelowAI", "shareExpert",
  // Capability, in threshold-expert equivalents, with and without the AI multiplier.
  // Added 2026-08 with the capability model; without them the batch runner recorded
  // nothing about it at all, so any sweep of an AI parameter that acts only on
  // capability (frontierBreadth) would have written 21 identical columns.
  "systemCapability", "systemCapabilityHuman",
  // Headcount as a fraction of the establishment. 1 unless a recruitment freeze has left
  // slots unfilled. Recorded because systemCapability is an absolute SUM over people, so
  // it falls with headcount as well as with expertise; without this column the two are
  // not separable in the output.
  "activeFraction",
  // occupancy diagnostics — asymmetric mobility drains low-market-index
  // institutions by design, and a run where these get small is suspect
  "minOccupancy", "emptyInstitutions", "underOccupiedInstitutions"];

/* ============================== world model (Phase F) ============================== */
// A loaded world model contains a closure (affinity), so it cannot be passed
// through worker_threads' structured clone. Each thread therefore loads it
// itself from the paths in the config and caches it — parsing a 400KB JSON once
// per worker is negligible against thousands of runs, and it keeps runJob
// identical in the main thread and in workers.
let WORLD_MODEL_CACHE = null;
function resolveWorldModel(spec) {
  if (!spec) return null;
  if (WORLD_MODEL_CACHE) return WORLD_MODEL_CACHE;
  const { loadWorldModel } = require(path.join(__dirname, "world_model.js"));
  // worldModelPath/mobilityCostsPath in a config are relative to data/, so a config
  // says "world-model.json" and not "../data/world-model.json". Absolute paths still
  // win, since path.resolve ignores the base for those.
  const world = JSON.parse(fs.readFileSync(path.resolve(paths.DATA, spec.worldModelPath), "utf8"));
  const costs = JSON.parse(fs.readFileSync(path.resolve(paths.DATA, spec.mobilityCostsPath), "utf8"));
  WORLD_MODEL_CACHE = loadWorldModel(world, costs, spec.worldModelOptions || {});
  return WORLD_MODEL_CACHE;
}

/* ============================== job execution (shared by main + workers) ============================== */
function runJob(job) {
  const params = Object.assign({}, job.params, { seed: job.seed });
  if (params.graphSource === "worldModel") {
    params.worldModel = resolveWorldModel(job.worldModelSpec);
    if (!params.worldModel) throw new Error("[batch] graphSource 'worldModel' needs config.worldModel { worldModelPath, mobilityCostsPath }");
  }
  const sim = initSim(params);
  const rows = [];
  const recordSet = new Set(job.recordAt);
  const maxT = job.recordAt[job.recordAt.length - 1];
  for (let step = 1; step <= maxT; step++) {
    const entry = tick(sim);
    if (recordSet.has(step)) rows.push(buildRow(sim, job, entry));
  }
  return rows;
}

function buildRow(sim, job, entry) {
  // Full param provenance for every row — but scalars only. params.worldModel is
  // an entire loaded graph (arrays, Sets, and an affinity closure); copying it
  // into every row would balloon memory and cannot be serialised to CSV. Its
  // identity is carried by worldModelFingerprint below instead, which is the
  // thing actually needed to tell two result sets apart.
  const row = {};
  for (const k of Object.keys(sim.params)) {
    const v = sim.params[k];
    if (v === null || typeof v !== "object") row[k] = v;
  }
  if (sim.graph && sim.graph.isWorldModel) {
    row.worldModelFingerprint = sim.graph.fingerprint;
    row.M = sim.M; // derived, not configured — record what was actually used
  }
  row.comboIndex = job.comboIndex;
  row.replicate = job.replicate;
  row.arm = job.arm || "";
  row.seed = job.seed;
  row.t = entry.t;
  for (const k of METRIC_KEYS) row[k] = entry[k];
  return row;
}

/* ============================== worker entry point ============================== */
// A worker is a loop, not a batch: it asks for a job, runs it, posts the rows back, and
// asks again. The main thread hands out the next job each time, so a slow core simply
// takes fewer jobs instead of holding up the barrier at the end.
if (!isMainThread) {
  parentPort.on("message", (msg) => {
    if (msg === null) { parentPort.close(); return; }   // queue drained
    parentPort.postMessage({ rows: runJob(msg) });
  });
  parentPort.postMessage({ ready: true });              // ask for the first job
}

/* ============================== sweep construction ============================== */
function resolveAxis(spec, key) {
  if (Array.isArray(spec.values)) return spec.values.slice();
  if (Array.isArray(spec.range)) {
    const [lo, hi] = spec.range;
    const steps = spec.steps || 2;
    if (steps <= 1) return [lo];
    const out = [];
    for (let i = 0; i < steps; i++) out.push(lo + (hi - lo) * (i / (steps - 1)));
    return out;
  }
  throw new Error(`params.${key} needs "values" or "range"+"steps" for grid mode`);
}

function randomDraw(spec, key, rng) {
  if (Array.isArray(spec.values)) return spec.values[Math.floor(rng() * spec.values.length)];
  if (Array.isArray(spec.range)) {
    const [lo, hi] = spec.range;
    const v = lo + (hi - lo) * rng();
    return spec.int ? Math.round(v) : v;
  }
  throw new Error(`params.${key} needs "values" or "range" for random mode`);
}

function cartesian(paramSpecs) {
  const keys = Object.keys(paramSpecs);
  const axes = keys.map((k) => resolveAxis(paramSpecs[k], k));
  let combos = [{}];
  keys.forEach((k, idx) => {
    const next = [];
    for (const combo of combos) for (const v of axes[idx]) next.push(Object.assign({}, combo, { [k]: v }));
    combos = next;
  });
  return combos;
}

function validateParamKeys(keys, label, isWorldModel) {
  const valid = new Set(Object.keys(DEFAULT_PARAMS));
  for (const k of keys) if (!valid.has(k)) {
    throw new Error(`unknown parameter "${k}" in config.${label} (valid keys: ${[...valid].join(", ")})`);
  }
  // Only in world-model mode: M is derived from the data there, so setting or
  // sweeping it is a contradiction rather than a preference. Under BA it stays a
  // perfectly ordinary parameter, so this must not fire.
  if (isWorldModel && keys.includes("M")) {
    throw new Error(`[batch] M cannot be set in config.${label} — it is derived from the world model when graphSource is "worldModel"`);
  }
}

function buildJobs(config) {
  const mode = config.mode || "grid";
  const fixed = config.fixed || {};
  const replicates = config.replicates || 1;
  const horizon = config.horizon;
  if (!horizon || horizon < 1) throw new Error("config.horizon must be a positive integer");
  const recordAt = (config.recordAt && config.recordAt.length ? config.recordAt.slice() : [horizon]).sort((a, b) => a - b);
  if (recordAt.some((t) => t < 1 || t > horizon)) throw new Error("every config.recordAt value must be between 1 and config.horizon");
  const baseSeed = config.seed != null ? config.seed : 1;
  const paramSpecs = config.params || {};

  const usingWorldModel = (fixed.graphSource || "ba") === "worldModel";
  validateParamKeys(Object.keys(fixed), "fixed", usingWorldModel);
  validateParamKeys(Object.keys(paramSpecs), "params", usingWorldModel);

  // Paths, not a loaded object: each worker resolves it itself (see resolveWorldModel).
  const worldModelSpec = config.worldModel || null;
  if (worldModelSpec && (!worldModelSpec.worldModelPath || !worldModelSpec.mobilityCostsPath)) {
    throw new Error("[batch] config.worldModel needs both worldModelPath and mobilityCostsPath");
  }

  const pairWithBaseline = !!config.pairWithBaseline;
  if (pairWithBaseline && ("aiEnabled" in fixed || "aiEnabled" in paramSpecs)) {
    throw new Error('config.pairWithBaseline sets aiEnabled itself — remove "aiEnabled" from config.fixed/config.params');
  }
  const baselineParams = config.baselineParams || {};
  if (!pairWithBaseline && Object.keys(baselineParams).length) {
    throw new Error('config.baselineParams needs pairWithBaseline: true — there is no baseline arm to apply it to');
  }
  if ("aiEnabled" in baselineParams) {
    throw new Error('config.baselineParams must not set aiEnabled — the baseline arm is the no-AI arm by definition');
  }
  // Overriding a parameter that is also SWEPT makes the baseline identical in every cell
  // of that axis. That is legitimate and is usually the point -- a single fixed reference
  // the whole grid is measured against -- but it changes what the axis means: the cells
  // then differ only in the treatment arm, so a gradient along it is the treatment moving,
  // not a paired difference narrowing. Said out loud rather than assumed, because the
  // resulting heatmap looks the same either way.
  Object.keys(baselineParams).forEach((k) => {
    if (k in paramSpecs) {
      console.error(`[batch] note: baselineParams pins "${k}", which is also swept. The baseline`
        + ` is therefore the SAME run in every cell of that axis — a fixed reference, not a`
        + ` per-cell twin. Gradients along it are the treatment arm moving.`);
    }
  });

  let combos;
  if (mode === "grid") {
    combos = cartesian(paramSpecs);
  } else if (mode === "random") {
    if (!config.runs) throw new Error('config.runs is required when config.mode is "random"');
    const rng = mulberry32((baseSeed ^ 0x5eed0001) >>> 0);
    combos = [];
    for (let i = 0; i < config.runs; i++) {
      const combo = {};
      for (const k of Object.keys(paramSpecs)) combo[k] = randomDraw(paramSpecs[k], k, rng);
      combos.push(combo);
    }
  } else {
    throw new Error('config.mode must be "grid" or "random"');
  }

  const jobs = [];
  combos.forEach((combo, comboIndex) => {
    for (let r = 0; r < replicates; r++) {
      const seed = ((baseSeed + 1) * 1000003 + comboIndex * 10007 + r * 97) >>> 0;
      if (pairWithBaseline) {
        // same seed for both arms — that's what makes "baseline vs treatment" a valid
        // paired comparison instead of two independently-noisy runs
        jobs.push({ comboIndex, replicate: r, seed, recordAt, arm: "treatment", worldModelSpec, params: Object.assign({}, fixed, combo, { aiEnabled: true }) });
        // baselineParams lets the reference arm differ from the treatment arm in more
        // than aiEnabled. It exists because "what did AI cost" is not always the question:
        // the recruitment set asks what AI AND a hiring freeze together cost against a
        // world with neither, which needs the freeze switched off in the baseline too.
        // Applied AFTER aiEnabled:false, so a config cannot accidentally re-enable AI in
        // the reference arm.
        //
        // The seed is still shared, so the two arms start from the same population and the
        // comparison is paired. They will diverge in their RANDOM STREAM as soon as the
        // overridden parameter changes how many draws a tick takes — unavoidable, and the
        // reason the *_change columns of such a set carry more replicate noise than one
        // where the arms differ only in a multiplier.
        jobs.push({ comboIndex, replicate: r, seed, recordAt, arm: "baseline", worldModelSpec,
          params: Object.assign({}, fixed, combo, { aiEnabled: false }, baselineParams) });
      } else {
        jobs.push({ comboIndex, replicate: r, seed, recordAt, arm: null, worldModelSpec, params: Object.assign({}, fixed, combo) });
      }
    }
  });
  return { jobs, combos, replicates, pairWithBaseline };
}

// Metrics carried into the paired comparison; negative change means treatment
// produced less than its baseline. Output is streamed by batch_output.js.
const SHORTFALL_KEYS = ["meanE", "shareExpert", "systemCapability", "systemCapabilityHuman",
  "activeFraction"];

/* ============================== parallel execution ============================== */
// A worker receives its next job only after the previous result has been consumed.
// Slow disk writes therefore pause dispatch instead of accumulating the entire sweep
// (or an unbounded stream write queue) on the main thread's heap.
async function* runWithWorkers(jobs, n) {
  const workers = [], queue = [];
  let wake, next = 0, completed = 0;
  const enqueue = (event) => {
    queue.push(event);
    if (wake) { const resolve = wake; wake = null; resolve(); }
  };
  try {
    for (let i = 0; i < Math.min(n, jobs.length); i++) {
      const worker = new Worker(__filename);
      workers.push(worker);
      worker.on("message", (message) => enqueue({ worker, message }));
      worker.on("error", (error) => enqueue({ error }));
      worker.on("exit", (code) => {
        if (code !== 0) enqueue({ error: new Error(`worker exited with code ${code}`) });
      });
    }
    while (completed < jobs.length) {
      if (!queue.length) await new Promise((resolve) => { wake = resolve; });
      const { worker, message, error } = queue.shift();
      if (error) throw error;
      if (message.rows) {
        yield message.rows;
        completed++;
      }
      if (next < jobs.length) worker.postMessage(jobs[next++]);
      else worker.postMessage(null);
    }
  } finally {
    await Promise.allSettled(workers.map((worker) => worker.terminate()));
  }
}

function* runSequential(jobs) {
  for (const job of jobs) yield runJob(job);
}

/* ============================== CLI ============================== */
function parseArgs(argv) {
  const args = { out: "results.csv", summaryOut: "results_summary.csv", shortfallOut: "results_shortfall.csv", workers: null, dryRun: false };
  const takesValue = new Set(["--config", "--out", "--from-results", "--summary-out", "--shortfall-out", "--workers"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (takesValue.has(a) && (argv[i + 1] === undefined || argv[i + 1].startsWith("--"))) {
      throw new Error(`${a} needs a value`);
    }
    if (a === "--config") args.config = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--no-raw") args.out = null;
    else if (a === "--from-results") args.fromResults = argv[++i];
    else if (a === "--summary-out") args.summaryOut = argv[++i];
    else if (a === "--no-summary") args.summaryOut = null;
    else if (a === "--shortfall-out") args.shortfallOut = argv[++i];
    else if (a === "--no-shortfall") args.shortfallOut = null;
    else if (a === "--workers") args.workers = Number(argv[++i]);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
    else throw new Error("unknown argument: " + a);
  }
  return args;
}

function printHelp() {
  console.error(`
Batch-run the capability-decay simulator across a parameter sweep.

  node batch_run.js --config sweep.json [options]

Options:
  --out <path>          per-run CSV output (default results.csv)
  --no-raw              skip the per-run CSV (summaries and comparisons still stream)
  --from-results <path>  recover summaries/comparisons from a completed raw CSV without
                        simulating again; validates every expected run and tick against
                        --config, and leaves the input CSV unchanged
  --summary-out <path>  per-parameter-combo mean/std CSV (default results_summary.csv)
  --no-summary          skip the summary CSV
  --shortfall-out <path>  baseline-vs-AI expertise shortfall CSV, only written when the
                          config sets "pairWithBaseline": true (default results_shortfall.csv)
  --no-shortfall        skip the shortfall CSV even if pairWithBaseline is set
  --workers <n>         parallel worker threads (default: min(cpus, 8))
  --dry-run             print the run count and exit without simulating

See engine.js DEFAULT_PARAMS for every sweepable key, and sweep.example.json
/ sweep.random.example.json for complete config examples.
`);
}

/* ============================== main ============================== */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config) { printHelp(); process.exit(1); return; }

  const config = JSON.parse(fs.readFileSync(args.config, "utf8"));
  const { jobs, combos, replicates, pairWithBaseline } = buildJobs(config);

  const armNote = pairWithBaseline ? " (x2 for baseline+treatment pairing)" : "";
  console.error(`[batch] ${combos.length} parameter combination(s) x ${replicates} replicate(s)${armNote} = ${jobs.length} run(s)`);
  console.error(`[batch] each run simulates up to t=${jobs[0].recordAt[jobs[0].recordAt.length - 1]}, recording at t=${jobs[0].recordAt.join(",")}`);

  if (args.dryRun) { console.error("[batch] dry run — not executing."); return; }

  const workers = args.workers != null ? args.workers : Math.max(1, Math.min(os.cpus().length, 8));
  if (!Number.isInteger(workers) || workers < 1) throw new Error("--workers needs a positive integer");
  if (args.fromResults) {
    const input = path.resolve(args.fromResults);
    for (const output of [args.summaryOut, pairWithBaseline && args.shortfallOut].filter(Boolean)) {
      if (path.resolve(output) === input || path.resolve(output + ".part") === input) {
        throw new Error("recovery output must not overwrite its input CSV");
      }
    }
    console.error(`[batch] recovering from ${args.fromResults} — no simulations will run`);
  } else console.error(`[batch] running with ${workers} worker${workers > 1 ? "s" : ""}`);

  const output = new BatchOutput({ jobs, replicates, pairWithBaseline,
    raw: args.fromResults ? null : args.out, summary: args.summaryOut, shortfall: args.shortfallOut,
    metricKeys: METRIC_KEYS, shortfallKeys: SHORTFALL_KEYS });
  const t0 = Date.now();
  try {
    if (args.fromResults) {
      for await (const row of readResultRows(args.fromResults, DEFAULT_PARAMS, METRIC_KEYS)) {
        await output.add(row);
        if (output.count % 250000 === 0) console.error(`[batch] read ${output.count}/${output.expectedRows} rows`);
      }
    } else {
      let done = 0;
      const logEvery = Math.max(1, Math.floor(jobs.length / 20));
      const batches = workers === 1 ? runSequential(jobs) : runWithWorkers(jobs, workers);
      for await (const rows of batches) {
        for (const row of rows) await output.add(row);
        done++;
        if (done % logEvery === 0 || done === jobs.length) console.error(`[batch] ${done}/${jobs.length} runs`);
      }
    }
    await output.finish();
  } catch (error) {
    await output.abort();
    throw error;
  }
  console.error(`[batch] ${output.count} rows processed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const file of output.outputs) console.error(`[batch] wrote ${file.file} (${file.count} rows)`);
}

module.exports = { buildJobs, METRIC_KEYS, SHORTFALL_KEYS };

if (isMainThread && require.main === module) {
  main().catch((err) => { console.error("[batch] " + err.message); process.exit(1); });
}
