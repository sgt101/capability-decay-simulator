// Builds doc/report.html — a self-contained, no-server heatmap browser over every
// experiment.N.json result. Reads results/experiment.N/results_shortfall.csv
// (--results is relative to results/, --manifest relative to data/)
// (already replicate-averaged... no, per-replicate — this script does the
// averaging), embeds one aggregated grid per experiment as JSON, and injects
// it into report.template.html. Rerun after any batch of experiments changes:
//
//   node src/build_report.js
//   node src/build_report.js --manifest experiments.manifest.json --results archive/results-ba
//
// Two metric sets, written to two pages so each one opens on the question it answers
// rather than hiding it behind a dropdown:
//
//   node src/build_report.js --metrics expertise  --out graph-results-expertise.html
//   node src/build_report.js --metrics capability --out graph-results-capability.html
//
// ...and for the structure set, which files its results under results/structure.N/:
//
//   node src/build_report.js --manifest experiments.structure.manifest.json \
//     --results . --stem structure --metrics capability \
//     --out graph-results-capability.html
//
// CAPABILITY NEEDS RESULTS WRITTEN BY THE CURRENT batch_run.js. systemCapability
// joined METRIC_KEYS in 2026-08; every CSV older than that has none of those columns,
// and the build stops with the list rather than publishing a blank grid.
//
// THE MANIFEST MUST MATCH THE RESULTS. It supplies the x/y axis keys per
// experiment; results/ only supplies columns. Point the BA manifest at
// world-model results and experiment 6 is read as learningRateSpread x
// transferRate — both of which are present but CONSTANT in those runs, so the
// whole 15x15 grid silently collapses to one averaged cell. That happened. The
// degenerate-axis guard below exists so it cannot happen quietly again.

"use strict";
const fs = require("fs");
const path = require("path");
const paths = require("./paths.js");

const ROOT = paths.ROOT;

function argOf(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
// Default to the world-model set: that is what experiments/ holds and what
// run_experiments.sh writes into results/.
const MANIFEST_PATH = argOf("--manifest", "experiments.worldmodel.manifest.json");
const RESULTS_DIR = argOf("--results", ".");   // relative to results/
const OUT_PATH = argOf("--out", "report.html");
// Directory stem under results/. The world-model and BA sets both write
// results/experiment.N/; the structure set writes results/structure.N/.
const STEM = argOf("--stem", "experiment");
// Tab title. Derived from STEM by default — "experiment" is the world-model AI
// dampening/level sweeps, "structure" is the M x graphAttachment set, "acl" is the
// Dell'Acqua/Stromberg scenario set — and overridable with --title for a one-off page.
const TITLE_BY_STEM = { experiment: "AI Params", structure: "Structure Params", acl: "Capability Params" };
const TITLE = argOf("--title", TITLE_BY_STEM[STEM] || "Experiment Report");
const METRIC_SET = argOf("--metrics", "expertise");
// Where a heatmap cell click sends the reader. Defaults to the on-disk layout (doc/ to
// src/), which is how these pages are opened most of the time; build_reports.sh passes
// the published layout's value instead. See SIMULATOR_HREF in report.template.html.
const SIMULATOR_HREF = argOf("--simulator-href", "../src/simulator.html");

const manifest = JSON.parse(fs.readFileSync(path.resolve(paths.DATA, MANIFEST_PATH), "utf8"));

// A metric may be a plain CSV column, or DERIVED from several via `from(row)`.
// `log: true` stores log10 of the aggregated value — capability runs from thousands
// to millions, and on a linear ramp every cell but the largest collapses to one shade.
// Reads the signed `_change` column, falling back to the legacy `_shortfall` with its
// sign flipped. Both name the same comparison — treatment against the paired baseline —
// but in opposite directions, and results predating 2026-08 carry only the old one. The
// fallback is what keeps the archived world-model set (17 CPU-hours) readable without
// re-running it.
function changeOf(key) {
  return (row) => {
    const now = num(row[key + "_change"]);
    if (now != null) return now;
    const legacy = num(row[key + "_shortfall"]);
    return legacy == null ? null : -legacy;
  };
}

// Sign-convention guard for every _change metric: "treatment below baseline" must come
// out negative. Checked against the RAW CSV row rather than the built page's payload,
// because baseline/treatment level columns are deliberately not shipped to the reader
// (see the comment on METRIC_SETS) — a check that could only compare displayed metrics
// against each other would have nothing left to verify a flipped operand against. Runs
// once per row for every experiment, on every build, regardless of which --metrics set
// is being rendered.
function checkChangeSign(rawKey, row) {
  const b = num(row[rawKey + "_baseline"]), t = num(row[rawKey + "_treatment"]);
  if (b == null || t == null) return;
  const c = changeOf(rawKey)(row);
  if (c == null) return;
  if (t < b - 1e-6 && c >= 0) {
    throw new Error(`[build_report] sign inverted: ${rawKey} treatment ${t} is below baseline ${b} but change reads ${c}`);
  }
  if (t > b + 1e-6 && c <= 0) {
    throw new Error(`[build_report] sign inverted: ${rawKey} treatment ${t} is above baseline ${b} but change reads ${c}`);
  }
}
const SIGN_CHECK_KEYS = ["meanE", "shareExpert", "systemCapability"];

const METRIC_SETS = {
  // ABSOLUTE LEVELS (meanE_baseline/treatment, shareExpert_baseline/treatment) were
  // removed in 2026-08. What a reader of this report wants is whether AI moved the
  // field and by how much, not the raw level of either arm on its own — the level
  // metrics answered a question nobody was asking and, on a log-free linear scale,
  // made it easy to mistake "this cell is a big number" for "AI mattered here". The
  // paired _change metrics ARE the comparison; keep only those.
  expertise: [
    { key: "meanE_change", label: "Mean expertise, change from no-AI", from: changeOf("meanE"),
      help: "How the average skill level differs with AI, against the same world without it. Below zero means AI cost the field skill; above zero means it added some." },
    { key: "shareExpert_change", label: "Expert share, change from no-AI", from: changeOf("shareExpert"),
      help: "How much of the workforce counts as expert, against the same world without AI. -0.2 means a fifth of the population fell below the expert line." },
  ],
  capability: [
    // The headline, and derived rather than taken raw for a reason: the absolute
    // shortfall is in expert-equivalents, and cells differ several-fold in how much
    // capability they hold at all — a structure sweep would then colour by how big the
    // field is rather than by how much of it AI cost. The FRACTION is comparable across
    // every cell in the grid.
    { key: "capabilityChangeFrac", label: "Capability, share gained or lost",
      help: "Change in what the field can get done, versus the same world without AI. Below zero: AI cost capability. Above zero: AI added it.",
      from: (r) => { const b = num(r.systemCapability_baseline), t = num(r.systemCapability_treatment);
        return b && b > 0 && t != null ? (t - b) / b : null; } },
    { key: "systemCapability_change", label: "Capability, change in expert-equivalents", from: changeOf("systemCapability"),
      help: "The same change counted in people rather than percentages: how many experts' worth of work the field gained or lost. Below zero means work it no longer gets done." },
    // systemCapability_baseline/treatment and systemCapabilityHuman_treatment (all
    // absolute log10 LEVELS) were removed alongside the expertise levels above, for the
    // same reason: capabilityChangeFrac and systemCapability_change already say what
    // changed, and aiLeverage below already says how much of the with-AI total is the
    // AI's own contribution — nothing here needed a third, unpaired absolute number.
    { key: "aiLeverage", label: "AI leverage (× over unaugmented)",
      help: "How much more the field gets done with AI than the same people manage without it. 1.2 means a fifth more work.",
      from: (r) => { const t = num(r.systemCapability_treatment), h = num(r.systemCapabilityHuman_treatment);
        return h && h > 0 && t != null ? t / h : null; } },
  ],
};
// Everything, for a single page whose dropdown carries both. The split pages exist so
// each opens on the question it answers; this one exists so a set can be inspected
// without deciding that question first.
METRIC_SETS.all = METRIC_SETS.expertise.concat(METRIC_SETS.capability);

if (!METRIC_SETS[METRIC_SET]) {
  console.error(`[build_report] unknown --metrics "${METRIC_SET}" (have: ${Object.keys(METRIC_SETS).join(", ")})`);
  process.exit(1);
}
const METRICS = METRIC_SETS[METRIC_SET];
const NUMERIC_METRIC_KEYS = METRICS.map((m) => m.key);
const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

function parseCSV(text) {
  const lines = text.split("\n").filter((l) => l.length);
  const cols = lines[0].split(",");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const row = {};
    for (let c = 0; c < cols.length; c++) row[cols[c]] = parts[c];
    rows.push(row);
  }
  return rows;
}

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

const degenerate = [];

// --- panel-level statistics -------------------------------------------------------
//
// One heatmap's worth of numbers, per metric and per tick, so a reader can tell at a
// glance whether the surface in front of them carries any signal. Six figures:
//
//   mean/min/max  the grid's cell means — plain description of what is on screen.
//   sem           the NOISE FLOOR: the standard error of a SINGLE cell, pooled across
//                 the grid. Shown as ±2·sem. This is what a cell's colour is worth.
//   sd            the SIGNAL: the spread of cell means with the noise variance
//                 subtracted off, sqrt(max(0, var(cellMeans) - mean(se^2))). Without
//                 that subtraction a flat panel reads ~40% more structured than it is,
//                 because seed scatter between cells is counted as parameter response.
//   sn            sd/sem. The number that actually separates a live panel from a dead
//                 one; on this project's sets it ranges from 0.6 to 57.
//
// NOT a confidence interval on the mean, and deliberately not presented as one: `sd`
// describes how much the surface varies across the sweep, `sem` how much one cell
// wobbles between seeds. Conflating them into a single ±2SD band around the mean is
// exactly the misreading these six numbers exist to prevent.
//
// Every figure is computed on the DISPLAYED scale. For a `log` metric the cell value on
// screen is log10(mean over replicates), so the per-cell standard error is carried
// through the same transform by the delta method — se/(mean·ln10) — rather than being
// reported in the untransformed units the reader is not looking at.
function gridStats(sum, sq, seen, size, NT, def) {
  const LN10 = Math.LN10;
  const out = { mean: [], min: [], max: [], sem: [], sd: [], sn: [] };
  const nCells = size / NT;
  for (let ti = 0; ti < NT; ti++) {
    let n = 0, s = 0, ss = 0, lo = Infinity, hi = -Infinity, se2Sum = 0, se2N = 0;
    for (let c = 0; c < nCells; c++) {
      const p = c * NT + ti;
      const cn = seen[p];
      if (!cn) continue;
      let mu = sum[p] / cn;
      // Unbiased within-cell variance across replicates, from the running sums.
      // Clamped at zero: with cn small and the values near-identical, catastrophic
      // cancellation in (sq - sum^2/cn) can land a hair below it.
      let se2 = cn > 1 ? Math.max(0, (sq[p] - (sum[p] * sum[p]) / cn) / (cn - 1)) / cn : null;
      if (def && def.log) {
        if (!(mu > 0)) continue;
        if (se2 != null) se2 = se2 / Math.pow(mu * LN10, 2);
        mu = Math.log10(mu);
      }
      if (!Number.isFinite(mu)) continue;
      n++; s += mu; ss += mu * mu;
      if (mu < lo) lo = mu;
      if (mu > hi) hi = mu;
      if (se2 != null) { se2Sum += se2; se2N++; }
    }
    if (!n) { ["mean", "min", "max", "sem", "sd", "sn"].forEach((k) => out[k].push(null)); continue; }
    const mean = s / n;
    const varCells = n > 1 ? Math.max(0, (ss - (s * s) / n) / (n - 1)) : 0;
    // se2N === 0 means one replicate per cell: the noise floor is not merely small,
    // it is unmeasured. Null rather than zero, so the page can say so.
    const meanSe2 = se2N ? se2Sum / se2N : null;
    const sem = meanSe2 == null ? null : Math.sqrt(meanSe2);
    const sd = meanSe2 == null ? Math.sqrt(varCells) : Math.sqrt(Math.max(0, varCells - meanSe2));
    out.mean.push(round(mean)); out.min.push(round(lo)); out.max.push(round(hi));
    out.sem.push(sem == null ? null : round(sem));
    out.sd.push(round(sd));
    // sd === 0 with sem === 0 is a grid of identical values — a dead panel, and the
    // case the badge most needs to fire on, so it scores 0 rather than falling into
    // the "cannot say" branch. sem === 0 with sd > 0 is signal against no measurable
    // noise: real, but not a ratio, so null.
    out.sn.push(sem ? Math.round((sd / sem) * 10) / 10
      : sem === 0 && sd === 0 ? 0
      : null);
  }
  return out;
}

// Same magnitude-aware rounding the cell payload uses: 1e-5 resolution on the [-1, 1]
// metrics, 1e-3 once a value is in the hundreds and those digits are noise anyway.
function round(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.abs(v) >= 100 ? Math.round(v * 1e3) / 1e3 : Math.round(v * 1e5) / 1e5;
}

function loadExperiment(entry) {
  const file = path.resolve(paths.RESULTS, RESULTS_DIR, `${STEM}.${entry.n}`, "results_shortfall.csv");
  if (!fs.existsSync(file)) {
    console.error(`[build_report] skip ${STEM}.${entry.n}: ${file} not found (run the matching runner for ${entry.n} first)`);
    return null;
  }
  const rows = parseCSV(fs.readFileSync(file, "utf8"));
  const xKey = entry.x, yKey = entry.y;

  // The manifest claims these two columns are swept. If the results disagree,
  // the manifest describes a different experiment set than the one that was
  // run — averaging over the axes that ARE swept would produce a plausible
  // looking but meaningless single cell. Refuse.
  if (!rows.length || !(xKey in rows[0]) || !(yKey in rows[0])) {
    degenerate.push({ n: entry.n, xKey, yKey, why: "axis column absent from CSV" });
    return null;
  }
  const distinct = (k) => new Set(rows.map((r) => r[k])).size;
  const nx = distinct(xKey), ny = distinct(yKey);
  if (nx < 2 || ny < 2) {
    degenerate.push({ n: entry.n, xKey, yKey, nx, ny, why: "axis is constant in the results" });
    return null;
  }

  const xValues = [...new Set(rows.map((r) => num(r[xKey])))].sort((a, b) => a - b);
  const yValues = [...new Set(rows.map((r) => num(r[yKey])))].sort((a, b) => a - b);

  // Where the manifest records the axis VALUES it expected — not merely the axis names —
  // check the CSV actually contains them. The degenerate-axis guard above only catches
  // an axis that does not vary at all; this catches the subtler case of results left
  // over from an earlier generation that swept the same parameter over a different
  // range. Those render as a plausible heatmap of the wrong grid.
  const axisMismatch = (label, expected, got) => {
    if (!Array.isArray(expected)) return null;
    const e = expected.slice().sort((a, b) => a - b);
    if (e.length === got.length && e.every((v, i) => Math.abs(v - got[i]) < 1e-9)) return null;
    return `${label} axis: manifest expects ${e.length} values (${e[0]}..${e[e.length - 1]}), `
      + `CSV has ${got.length} (${got[0]}..${got[got.length - 1]})`;
  };
  const mm = axisMismatch(xKey, entry.xValues, xValues) || axisMismatch(yKey, entry.yValues, yValues);
  if (mm) { degenerate.push({ n: entry.n, xKey, yKey, why: mm + " — stale results from an earlier generation?" }); return null; }

  // Held-fixed parameters, checked the same way and for the same reason as the axes.
  // A run's identity is its whole configuration, not just what it swept: changing N or
  // the horizon leaves every axis and the replicate count untouched, so both guards
  // above pass and the page then describes results produced at a different scale. That
  // exact case happened — the manifest said N=10,500 over N=4,000 data.
  //
  // Compared over the INTERSECTION of what the manifest fixed and what the CSV records,
  // skipping the swept axes (fixed carries a per-experiment default for those) and
  // anything non-scalar (a loaded world model is not a CSV column).
  if (manifest.baseFixed && rows.length) {
    const drifted = [];
    Object.keys(manifest.baseFixed).forEach((k) => {
      if (k === xKey || k === yKey) return;
      const want = manifest.baseFixed[k];
      if (want === null || typeof want === "object") return;
      if (!(k in rows[0])) return;                      // not recorded, nothing to compare
      const got = rows[0][k];
      const same = typeof want === "number"
        ? Math.abs(num(got) - want) < 1e-9
        : String(want) === String(got);
      if (!same) drifted.push(`${k}: manifest ${want}, results ${got}`);
    });
    if (drifted.length) {
      degenerate.push({ n: entry.n, xKey, yKey,
        why: drifted.join("; ") + " — stale results from an earlier generation?" });
      return null;
    }
  }

  // Replicate count, checked the same way and for the same reason. Changing replicates
  // leaves the axes untouched, so the check above sees nothing wrong — and the page then
  // states a replicate count in its header that the data does not have, which is exactly
  // the sort of quiet mismatch this whole section exists to refuse. Counted from the
  // rows rather than trusted: it is the number of runs that actually landed in a cell.
  if (manifest.replicates != null) {
    const perCell = new Map();
    for (const row of rows) {
      const k = row[xKey] + "|" + row[yKey] + "|" + row.t;
      perCell.set(k, (perCell.get(k) || 0) + 1);
    }
    const counts = [...new Set(perCell.values())];
    if (counts.length === 1 && counts[0] !== manifest.replicates) {
      degenerate.push({ n: entry.n, xKey, yKey,
        why: `manifest says ${manifest.replicates} replicates, CSV has ${counts[0]} per cell — stale results from an earlier generation?` });
      return null;
    }
  }
  const ticks = [...new Set(rows.map((r) => num(r.t)))].sort((a, b) => a - b);
  const NY = yValues.length, NT = ticks.length;
  const size = xValues.length * NY * NT;

  // COLUMNAR, not an array of cell objects. One object per cell re-encodes all
  // twelve key names — ~175 bytes of "shareExpert_treatment" and friends per
  // cell. At 21x21x120x55 that is 2.9M cells and the payload blew past V8's
  // ~536M-character string ceiling, so JSON.stringify threw RangeError. Here
  // each metric is one flat array indexed (xi*NY + yi)*NT + ti, so the key
  // names are paid for once per experiment instead of once per cell.
  const idxOf = (arr) => { const m = new Map(); arr.forEach((v, i) => m.set(v, i)); return m; };
  const xi = idxOf(xValues), yi = idxOf(yValues), ti = idxOf(ticks);

  const sums = {}, counts = new Int32Array(size);
  NUMERIC_METRIC_KEYS.forEach((k) => { sums[k] = new Float64Array(size); });
  const seen = {};
  NUMERIC_METRIC_KEYS.forEach((k) => { seen[k] = new Int32Array(size); });
  // Sum of SQUARES, carried alongside the sums for one reason: the mean on its own
  // cannot tell a real surface from seed noise wearing a colour ramp, and the spread
  // that would tell them apart is destroyed by the averaging two blocks down. One extra
  // Float64Array per metric buys the per-cell variance, and from it the panel-level
  // noise floor computed in gridStats(). Kept as a running sum rather than a second
  // pass over `rows` — these CSVs run to millions of rows.
  const sqs = {};
  NUMERIC_METRIC_KEYS.forEach((k) => { sqs[k] = new Float64Array(size); });

  // Accumulate in place — this collapses the replicate dimension via averaging.
  for (const row of rows) {
    SIGN_CHECK_KEYS.forEach((k) => checkChangeSign(k, row));
    const p = (xi.get(num(row[xKey])) * NY + yi.get(num(row[yKey]))) * NT + ti.get(num(row.t));
    counts[p]++;
    for (const k of NUMERIC_METRIC_KEYS) {
      const def = METRIC_BY_KEY.get(k);
      const v = def.from ? def.from(row) : num(row[k]);
      if (v == null || !Number.isFinite(v)) continue;
      sums[k][p] += v;
      sqs[k][p] += v * v;
      seen[k][p]++;
    }
  }

  // 5 decimals: 1e-5 resolution on metrics that all live in [-1, 1], which is
  // orders of magnitude finer than the replicate noise at 3 replicates, and
  // roughly halves the encoded size versus full double precision.
  // Averaged over replicates, then logged where asked — log AFTER the mean, so the
  // number shown is log10(mean capability) rather than a geometric mean wearing its name.
  //
  // Rounding is magnitude-aware. The original 5 decimals assumed every metric lived in
  // [-1, 1]; capability shortfall is in the thousands, where 1e-5 resolution is pure
  // payload for digits far below the replicate noise.
  const m = {};
  for (const k of NUMERIC_METRIC_KEYS) {
    const def = METRIC_BY_KEY.get(k);
    const out = new Array(size);
    for (let p = 0; p < size; p++) {
      if (!seen[k][p]) { out[p] = null; continue; }
      let v = sums[k][p] / seen[k][p];
      if (def.log) v = v > 0 ? Math.log10(v) : null;
      out[p] = v == null ? null
        : Math.abs(v) >= 100 ? Math.round(v * 1e3) / 1e3 : Math.round(v * 1e5) / 1e5;
    }
    m[k] = out;
  }

  // Per-metric, per-tick summary of the whole grid — see gridStats().
  const stats = {};
  for (const k of NUMERIC_METRIC_KEYS) {
    stats[k] = gridStats(sums[k], sqs[k], seen[k], size, NT, METRIC_BY_KEY.get(k));
  }

  // Replicate count per cell, collapsed to a scalar in the overwhelmingly
  // common case where the grid is complete and every cell got the same number.
  let uniform = counts[0];
  for (let p = 1; p < size; p++) if (counts[p] !== uniform) { uniform = null; break; }

  const fixed = Object.assign({}, manifest.baseFixed);
  Object.keys(manifest.studyParams).forEach((k) => {
    if (k !== xKey && k !== yKey) fixed[k] = manifest.studyParams[k].default;
  });

  return {
    n: entry.n, xKey, yKey, xValues, yValues, ticks, fixed, runs: entry.runs,
    // Names the SCENARIO where a set's experiments all share one axis pair. Optional:
    // the sweep sets do not set it and the list falls back to the axis names.
    label: entry.label,
    m, stats, reps: uniform, repsPerCell: uniform === null ? Array.from(counts) : undefined,
  };
}

const experiments = manifest.experiments.map(loadExperiment).filter(Boolean);

if (degenerate.length) {
  console.error(`\n[build_report] MANIFEST/RESULTS MISMATCH — ${degenerate.length} experiment(s) in ${RESULTS_DIR}/ do not match ${MANIFEST_PATH}:\n`);
  degenerate.forEach((d) =>
    console.error(`  ${STEM}.${d.n}: manifest says ${d.xKey} x ${d.yKey}` +
      (d.nx !== undefined ? ` but the CSV has ${d.nx} and ${d.ny} distinct value(s)` : "") + ` — ${d.why}`));
  // Two different causes, two different fixes, so both are offered rather than
  // guessing which one applies.
  const stale = degenerate.some((d) => /stale results/.test(d.why));
  if (stale) {
    console.error(`\n  The experiment set was REGENERATED since these were run. Delete the affected`);
    console.error(`  results and re-run them — anything not listed is skipped as already complete:`);
    console.error(`    rm -rf ${degenerate.map((d) => `results/${STEM}.${d.n}`).join(" ")}`);
    console.error(`    ./src/run_${STEM === "structure" ? "structure_" : ""}experiments.sh --workers 16`);
  } else {
    console.error(`\n  ${MANIFEST_PATH} does not describe the runs in ${RESULTS_DIR}/.`);
    console.error(`  Pass the matching one, e.g. --manifest experiments.worldmodel.manifest.json`);
    console.error(`  (world-model set, experiments/) or --manifest experiments.manifest.json`);
    console.error(`  (BA set, experiments-ABGraph/).`);
  }
  console.error(`  Nothing was written.\n`);
  process.exit(1);
}

if (!experiments.length) {
  console.error(`[build_report] no experiment results found under ${RESULTS_DIR}/ — run ./run_experiments.sh first`);
  process.exit(1);
}

// --- cell index: a short code for every heatmap cell, dereferenced by simulator.html --
// "AI-482" means: the 482nd cell (1-based, counting up through every experiment in this
// set in order, xi outer / yi inner within each) of whichever report PREFIX_BY_STEM maps
// this STEM to. Typing that code into simulator.html reproduces the exact scenario that
// cell represents, paused at t=0 — see data/cell-index.js and simulator.html's
// applyScenarioCode().
//
// STORED PER-EXPERIMENT, not per-cell. A flat table of ~12,000 cells x ~28 params each
// would run several megabytes; the "fixed" dict is identical for every cell in one
// experiment; storing it once per experiment (45 experiments total across all three
// report sets) and reconstructing each cell's params on the fly from
// {fixed, xValues[xi], yValues[yi]} keeps the whole merged file under a few hundred KB.
//
// MERGED, not overwritten: this file is written by three separate build scripts
// (report.html / structure_report.html / results_ACL.html), each responsible for one
// PREFIX. A single build only knows its own experiments, so it reads whatever the other
// two builds already wrote and replaces only its own prefix's block.
const PREFIX_BY_STEM = { experiment: "AI", structure: "STR", acl: "CAP" };
const CELL_INDEX_PREFIX = PREFIX_BY_STEM[STEM];
if (CELL_INDEX_PREFIX) {
  const scalarFixed = (fixed) => {
    const out = {};
    Object.keys(fixed).forEach((k) => {
      const v = fixed[k];
      if (v !== null && typeof v === "object") return;   // a loaded world model cannot be looked up from a code
      if (v !== undefined) out[k] = v;
    });
    return out;
  };
  let offset = 0;
  const cellIndexExperiments = experiments.map((e) => {
    const entry = {
      n: e.n, xKey: e.xKey, yKey: e.yKey,
      xValues: e.xValues, yValues: e.yValues,
      fixed: scalarFixed(e.fixed),
      startOffset: offset,
    };
    offset += e.xValues.length * e.yValues.length;
    return entry;
  });

  const jsonPath = path.resolve(paths.DATA, "cell-index.json");
  const jsPath = path.resolve(paths.DATA, "cell-index.js");
  let merged = {};
  if (fs.existsSync(jsonPath)) {
    try { merged = JSON.parse(fs.readFileSync(jsonPath, "utf8")); }
    catch (err) { console.error(`[build_report] cell-index.json is unreadable (${err.message}) — starting fresh`); }
  }
  merged[CELL_INDEX_PREFIX] = { totalCells: offset, experiments: cellIndexExperiments };

  fs.writeFileSync(jsonPath, JSON.stringify(merged, null, 2) + "\n");
  // The .js wrapper is what simulator.html actually loads, via a plain <script src> —
  // same reason world-model-data.js is a script and not fetched: this page has to keep
  // working when opened straight off disk (file://), where fetch() of a sibling file is
  // blocked by the browser's CORS policy but a <script src> is not.
  fs.writeFileSync(jsPath,
    "// Generated by build_report.js from cell-index.json. Do not edit by hand.\n"
    + "var CELL_INDEX = " + JSON.stringify(merged) + ";\n");
  console.log(`[build_report] cell-index: ${CELL_INDEX_PREFIX}-1..${CELL_INDEX_PREFIX}-${offset} (${cellIndexExperiments.length} experiments) -> data/cell-index.js`);
}

// Global, stable color domain per metric — computed once across every loaded
// experiment/tick so switching experiments never rescales the color mapping
// out from under the viewer.
const domains = {};
NUMERIC_METRIC_KEYS.forEach((k) => {
  let min = Infinity, max = -Infinity;
  experiments.forEach((e) => {
    const a = e.m[k];
    for (let p = 0; p < a.length; p++) {
      const v = a[p];
      if (v == null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  });
  domains[k] = [min, max];
});

// A metric with no data anywhere renders as a blank grid and says nothing about why.
// The usual cause is real and specific: capability was added to batch_run's METRIC_KEYS
// in 2026-08, so every CSV written before that carries none of these columns. Name it
// and stop, rather than publish an empty page that looks like a finding.
const emptyMetrics = NUMERIC_METRIC_KEYS.filter((k) => !Number.isFinite(domains[k][0]));
if (emptyMetrics.length === NUMERIC_METRIC_KEYS.length) {
  console.error(`\n[build_report] none of the "${METRIC_SET}" metrics appear in ${RESULTS_DIR}/${STEM}.*/results_shortfall.csv:\n`);
  emptyMetrics.forEach((k) => console.error(`  ${k}`));
  console.error(`\n  These results predate those columns. Re-run the experiments with the current`);
  console.error(`  batch_run.js and rebuild. Nothing was written.\n`);
  process.exit(1);
}
if (emptyMetrics.length) {
  console.error(`[build_report] warning: ${emptyMetrics.length} metric(s) are empty in these results and will render blank: ${emptyMetrics.join(", ")}`);
}

const meta = {
  generatedAt: new Date().toISOString(),
  replicates: manifest.replicates,
  horizon: manifest.horizon,
  metricSet: METRIC_SET,
  simulatorHref: SIMULATOR_HREF,
  stem: STEM,
  grid: [manifest.studyParams[manifest.experiments[0].x].values.length,
         manifest.studyParams[manifest.experiments[0].y].values.length],
  manifest: MANIFEST_PATH,
  resultsDir: RESULTS_DIR,
  metrics: METRICS,
  domains,
};

const templatePath = paths.src("report.template.html");
const outPath = path.resolve(paths.DOC, OUT_PATH);
let template = fs.readFileSync(templatePath, "utf8");
const titleTag = "<title>Experiment Report — Capability Decay Simulator</title>";
if (!template.includes(titleTag)) throw new Error(`report.template.html is missing the expected <title> tag`);
template = template.replace(titleTag, `<title>${TITLE}</title>`);
const placeholder = "/*__REPORT_DATA__*/";
if (!template.includes(placeholder)) throw new Error(`report.template.html is missing the ${placeholder} marker`);
const [head, tail] = template.split(placeholder);

// Streamed, one experiment at a time. Serialising the whole payload into a
// single string and then doing template.replace() needs ~3x the payload live at
// once and, past ~536M characters, cannot represent it at all. Each experiment
// on its own is a few MB, so this has no ceiling worth worrying about.
const out = fs.createWriteStream(outPath);
out.write(head);
out.write(JSON.stringify(meta).slice(0, -1)); // drop the closing brace
out.write(',"experiments":[');
experiments.forEach((e, i) => {
  if (i) out.write(",");
  out.write(JSON.stringify(e));
});
out.write("]}");
out.write(tail);
out.end();
out.on("close", () => {
  const mb = (fs.statSync(outPath).size / 1e6).toFixed(0);
  console.log(`[build_report] wrote ${OUT_PATH} (${mb} MB) from ${MANIFEST_PATH} + ${RESULTS_DIR}/ with ${experiments.length}/${manifest.experiments.length} experiments`);
});
if (experiments.length < manifest.experiments.length) {
  console.log(`[build_report] missing: ${manifest.experiments.filter((e) => !experiments.find((x) => x.n === e.n)).map((e) => e.n).join(", ")}`);
}
