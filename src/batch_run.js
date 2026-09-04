#!/usr/bin/env node
// Batch runner for the capability-decay engine — sweeps a parameter space
// across many simulation runs and writes per-run + summarized CSVs.
//
// Usage:
//   node src/batch_run.js --config data/sweep.json [--out results.csv] [--summary-out results_summary.csv]
//                      [--workers N] [--no-raw] [--dry-run]
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
} else {
  main().catch((err) => { console.error("[batch] " + err.message); process.exit(1); });
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

/* ============================== CSV output ============================== */
function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// Atomic write: build a temp file alongside the target, then rename. Rename is
// atomic within a filesystem, so a results file is either absent or complete —
// never a truncated half-write from an interrupted run. run_experiments.sh
// relies on this to decide what it can safely skip on resume.
// STREAMED, not built as one array of lines and joined. That used to be:
//   const lines = rows.map(rowToLine); writeFileSync(lines.join("\n"))
// which for the largest sweeps in this repository (400 cells x 32 replicates x 2 arms x
// 120 recorded ticks = ~3M rows for one experiment) holds three full-size copies of the
// same data at once -- the row objects, the array of formatted line strings, and the
// single joined mega-string -- on top of whatever else main() is holding. That is what
// turned "raise --max-runs" into "JavaScript heap out of memory" the moment the replicate
// count went up: removing the run-count guard did not create this cost, it only made it
// reachable. Streaming keeps at most one row's worth of formatted text resident at a time;
// the OS write buffer does the rest.
//
// `rows` is an ITERABLE, not necessarily an array — computeShortfall below is a generator
// for the same reason: the merged rows it used to return as one array are exactly as
// numerous as this file's rows, so building that array first would reintroduce the
// problem this function exists to avoid.
function writeCSVStream(filePath, rows) {
  return new Promise((resolve, reject) => {
    const tmp = filePath + ".part";
    const ws = fs.createWriteStream(tmp);
    ws.on("error", reject);
    let cols = null;
    let count = 0;
    // Iterated with an explicit iterator, not for..of, so a synchronous throw partway
    // through (a malformed row, say) still reaches the catch below with the stream
    // already open — for..of over a generator behaves the same, but making the manual
    // control flow explicit is what let this be written with backpressure in mind: a
    // future change that needs to await ws's 'drain' event has a loop shape ready for it,
    // rather than a for..of that would need restructuring first.
    try {
      for (const row of rows) {
        if (!cols) { cols = Object.keys(row); ws.write(cols.join(",") + "\n"); }
        ws.write(cols.map((c) => csvEscape(row[c])).join(",") + "\n");
        count++;
      }
    } catch (e) { ws.destroy(); reject(e); return; }
    ws.end(() => {
      if (count === 0) { fs.writeFileSync(tmp, ""); }
      fs.renameSync(tmp, filePath);
      resolve(count);
    });
  });
}

function summarize(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.comboIndex + "|" + row.arm + "|" + row.t;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const out = [];
  for (const group of groups.values()) {
    const base = Object.assign({}, group[0]);
    delete base.seed; delete base.replicate;
    METRIC_KEYS.forEach((k) => delete base[k]);
    METRIC_KEYS.forEach((k) => {
      const vals = group.map((g) => g[k]).filter((v) => v != null);
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      const variance = vals.length > 1 ? vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1) : 0;
      base[k + "_mean"] = mean;
      base[k + "_std"] = vals.length ? Math.sqrt(variance) : null;
    });
    base.n = group.length;
    out.push(base);
  }
  out.sort((a, b) => a.comboIndex - b.comboIndex || a.t - b.t);
  return out;
}

// meanC was dropped with the observed-capability channel in 2026-08. systemCapability is
// not its return: that one was a per-person observed score, this is the field's worth in
// threshold-expert equivalents, so baseline - treatment reads directly as "experts' worth
// of capability the AI cost us" — a subtraction that means something in these units.
// systemCapabilityHuman is paired too, for its TREATMENT column specifically: that is
// what the field is worth with the AI multiplier taken back off, i.e. what AI has done
// to the humans themselves. Its baseline column is redundant by construction (the no-AI
// arm has no multiplier, so baseline human == baseline total) and costs one column.
// The metrics the PAIRED csv carries as _baseline/_treatment/_change. A strict subset of
// METRIC_KEYS, and separate from it on purpose: results.csv records everything a run
// produced, while this file exists to answer one question — what AI changed — and a
// column that is identical in both arms only adds width.
//
// activeFraction is here despite being identical in both arms under the paired design
// (a hiring freeze applies to both), because the RECRUITMENT set needs it as a LEVEL:
// its report reads the baseline arm's headcount to separate a field that shrank from a
// field that lost its ladder. Adding it to METRIC_KEYS alone was not enough — that only
// reaches results.csv — which is exactly the trap this comment is here to close.
const SHORTFALL_KEYS = ["meanE", "shareExpert", "systemCapability", "systemCapabilityHuman",
  "activeFraction"];

// A GENERATOR, not a function returning an array. The merged rows it yields are as
// numerous as `rows` itself (one per baseline/treatment pair, so roughly half the total
// row count), and materialising that many new objects into an array before writing was
// the second-largest source of the same out-of-memory failure writeCSVStream's comment
// describes — cols[k] copies of the treatment row, one per pair, all resident at once
// purely so they could be sorted and then written. Consumed directly by writeCSVStream,
// which writes and discards each one as it is produced.
//
// The one thing this drops relative to the old version: rows are no longer globally
// sorted by (comboIndex, replicate, t) before writing, because sorting requires having
// them all in memory at once, which is exactly what this exists to avoid. Nothing reads
// results_shortfall.csv expecting a particular row order — build_report.js buckets every
// row into a grid by its own key regardless of file order — so this is a change to a
// human skimming the raw file, not to anything that parses it. Order instead follows
// Map iteration order, which for a Map built by a single forward pass over `rows` is
// insertion order — i.e. roughly job-completion order, not sorted, but not arbitrary
// either.
function* computeShortfall(rows) {
  const byPair = new Map(); // "comboIndex|replicate|t" -> { baseline, treatment }
  for (const row of rows) {
    if (!row.arm) continue;
    const key = row.comboIndex + "|" + row.replicate + "|" + row.t;
    if (!byPair.has(key)) byPair.set(key, {});
    byPair.get(key)[row.arm] = row;
  }
  for (const pair of byPair.values()) {
    if (!pair.baseline || !pair.treatment) continue; // one arm's job errored out — skip, don't half-report
    const base = Object.assign({}, pair.treatment);
    delete base.seed; delete base.arm; delete base.aiEnabled;
    METRIC_KEYS.forEach((k) => delete base[k]);
    SHORTFALL_KEYS.forEach((k) => {
      base[k + "_baseline"] = pair.baseline[k];
      base[k + "_treatment"] = pair.treatment[k];
      // SIGNED AS THE CHANGE: negative is what AI cost the field, positive is what it
      // added. This is the reverse of the old `_shortfall` column, which was baseline
      // minus treatment.
      //
      // Renamed rather than flipped in place, deliberately. A column still called
      // "shortfall" holding -0.5 reads as a shortfall OF -0.5, i.e. a gain — the exact
      // misreading the sign change exists to prevent, and one that no tooling could
      // detect. Old CSVs keep their old column and old meaning; build_report.js reads
      // either and negates the legacy one.
      base[k + "_change"] = pair.treatment[k] - pair.baseline[k];
    });
    yield base;
  }
}

/* ============================== parallel execution ============================== */
// DYNAMIC dispatch. This used to split the job list up front — chunk i getting every
// n'th job — which is only fair when every worker runs at the same speed.
//
// On a machine with heterogeneous cores it is not. Apple Silicon's performance and
// efficiency cores differ several-fold, so the workers that land on efficiency cores
// receive an equal share of jobs and take multiples of the time to finish them: the
// fast workers drain their chunk, exit, and sit idle while a few slow ones grind
// through the tail. Measured as machine utilisation that reads as a persistent 70%
// rather than a visible stall, because the shortfall is spread across the whole run.
//
// Pulling instead of pushing removes the assumption entirely: a core that is a third
// as fast takes a third as many jobs, and every worker finishes within one job of the
// others whatever hardware it landed on. It also costs nothing on homogeneous cores —
// the same total messages, one job at a time instead of one list up front.
function runWithWorkers(jobs, n) {
  const workerCount = Math.min(n, jobs.length);
  return new Promise((resolve, reject) => {
    const rows = [];
    let next = 0, finished = 0, live = 0;
    const logEvery = Math.max(1, Math.floor(jobs.length / 20));

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(__filename);
      live++;
      worker.on("message", (msg) => {
        if (msg.rows) {
          // Concatenated rather than pushed one row at a time: a job yields one row per
          // recordAt entry, and spreading thousands of them through apply() blows the
          // argument-count limit on a long recordAt.
          for (let k = 0; k < msg.rows.length; k++) rows.push(msg.rows[k]);
          finished++;
          if (finished % logEvery === 0 || finished === jobs.length) {
            console.error(`[batch] ${finished}/${jobs.length} runs`);
          }
        }
        if (next < jobs.length) worker.postMessage(jobs[next++]);
        else worker.postMessage(null);              // nothing left: tell it to close
      });
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) return reject(new Error(`worker exited with code ${code}`));
        if (--live === 0) resolve(rows);
      });
    }
  });
}

function runSequential(jobs) {
  const rows = [];
  const logEvery = Math.max(1, Math.floor(jobs.length / 20));
  jobs.forEach((job, i) => {
    rows.push(...runJob(job));
    if ((i + 1) % logEvery === 0 || i === jobs.length - 1) {
      console.error(`[batch] ${i + 1}/${jobs.length} runs complete`);
    }
  });
  return rows;
}

/* ============================== CLI ============================== */
function parseArgs(argv) {
  const args = { out: "results.csv", summaryOut: "results_summary.csv", shortfallOut: "results_shortfall.csv", workers: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") args.config = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--no-raw") args.out = null;
    else if (a === "--summary-out") args.summaryOut = argv[++i];
    else if (a === "--no-summary") args.summaryOut = null;
    else if (a === "--shortfall-out") args.shortfallOut = argv[++i];
    else if (a === "--no-shortfall") args.shortfallOut = null;
    else if (a === "--workers") args.workers = parseInt(argv[++i], 10);
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
  --no-raw              skip the per-run CSV -- nothing in this repository reads it back
                        (build_report.js and friends read only the shortfall CSV), so
                        it exists for manual inspection. Its cost scales with total
                        recorded rows -- cells x replicates x arms x ticks -- which is
                        the largest of the three output files by a wide margin on a big
                        sweep, so this is worth passing when that inspection is not needed
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

  const workers = args.workers != null ? Math.max(1, args.workers) : Math.max(1, Math.min(os.cpus().length, 8));
  console.error(`[batch] running with ${workers} worker${workers > 1 ? "s" : ""}`);

  const t0 = Date.now();
  const rows = workers === 1 ? runSequential(jobs) : await runWithWorkers(jobs, workers);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`[batch] ${jobs.length} runs -> ${rows.length} rows in ${elapsed}s`);

  if (args.out) {
    const n = await writeCSVStream(args.out, rows);
    console.error(`[batch] wrote ${args.out} (${n} rows)`);
  }

  if (args.summaryOut) {
    // summarize() still returns a plain array: its output is one row per (combo, arm,
    // tick) with replicates already collapsed, so for the sweeps that motivated
    // streaming (32 replicates) it is 32x smaller than `rows` and was never the problem.
    const summaryRows = summarize(rows);
    const n = await writeCSVStream(args.summaryOut, summaryRows);
    console.error(`[batch] wrote ${args.summaryOut} (${n} rows, mean/std across replicates)`);
  }

  if (pairWithBaseline && args.shortfallOut) {
    const n = await writeCSVStream(args.shortfallOut, computeShortfall(rows));
    console.error(`[batch] wrote ${args.shortfallOut} (${n} rows — baseline vs AI, negative change = AI eroded it)`);
  }
}
