// Builds report.html — a self-contained, no-server heatmap browser over every
// experiment.N.json result. Reads results/experiment.N/results_shortfall.csv
// (already replicate-averaged... no, per-replicate — this script does the
// averaging), embeds one aggregated grid per experiment as JSON, and injects
// it into report.template.html. Rerun after any batch of experiments changes:
//
//   node build_report.js
//   node build_report.js --manifest experiments.manifest.json --results results-ba
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

const ROOT = __dirname;

function argOf(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
// Default to the world-model set: that is what experiments/ holds and what
// run_experiments.sh writes into results/.
const MANIFEST_PATH = argOf("--manifest", "experiments.worldmodel.manifest.json");
const RESULTS_DIR = argOf("--results", "results");
const OUT_PATH = argOf("--out", "report.html");

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST_PATH), "utf8"));

const METRICS = [
  { key: "meanE_shortfall", label: "Mean expertise shortfall (E)" },
  { key: "shareExpert_shortfall", label: "Expert-share shortfall" },
  { key: "meanE_baseline", label: "Mean E — no-AI baseline" },
  { key: "meanE_treatment", label: "Mean E — with AI" },
  { key: "shareExpert_baseline", label: "Expert share — no-AI baseline" },
  { key: "shareExpert_treatment", label: "Expert share — with AI" },
];
const NUMERIC_METRIC_KEYS = METRICS.map((m) => m.key);

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

function loadExperiment(entry) {
  const file = path.join(ROOT, RESULTS_DIR, `experiment.${entry.n}`, "results_shortfall.csv");
  if (!fs.existsSync(file)) {
    console.error(`[build_report] skip experiment.${entry.n}: ${file} not found (run ./run_experiments.sh ${entry.n} first)`);
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

  // Accumulate in place — this collapses the replicate dimension via averaging.
  for (const row of rows) {
    const p = (xi.get(num(row[xKey])) * NY + yi.get(num(row[yKey]))) * NT + ti.get(num(row.t));
    counts[p]++;
    for (const k of NUMERIC_METRIC_KEYS) {
      const v = num(row[k]);
      if (v == null) continue;
      sums[k][p] += v;
      seen[k][p]++;
    }
  }

  // 5 decimals: 1e-5 resolution on metrics that all live in [-1, 1], which is
  // orders of magnitude finer than the replicate noise at 3 replicates, and
  // roughly halves the encoded size versus full double precision.
  const m = {};
  for (const k of NUMERIC_METRIC_KEYS) {
    const out = new Array(size);
    for (let p = 0; p < size; p++) out[p] = seen[k][p] ? Math.round((sums[k][p] / seen[k][p]) * 1e5) / 1e5 : null;
    m[k] = out;
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
    m, reps: uniform, repsPerCell: uniform === null ? Array.from(counts) : undefined,
  };
}

const experiments = manifest.experiments.map(loadExperiment).filter(Boolean);

if (degenerate.length) {
  console.error(`\n[build_report] MANIFEST/RESULTS MISMATCH — ${degenerate.length} experiment(s) have a sweep axis that does not vary in ${RESULTS_DIR}/:\n`);
  degenerate.forEach((d) =>
    console.error(`  experiment.${d.n}: manifest says ${d.xKey} x ${d.yKey}` +
      (d.nx !== undefined ? ` but the CSV has ${d.nx} and ${d.ny} distinct value(s)` : "") + ` — ${d.why}`));
  console.error(`\n  ${MANIFEST_PATH} does not describe the runs in ${RESULTS_DIR}/.`);
  console.error(`  Pass the matching one, e.g. --manifest experiments.worldmodel.manifest.json`);
  console.error(`  (world-model set, experiments/) or --manifest experiments.manifest.json`);
  console.error(`  (BA set, experiments-ABGraph/). Nothing was written.\n`);
  process.exit(1);
}

if (!experiments.length) {
  console.error(`[build_report] no experiment results found under ${RESULTS_DIR}/ — run ./run_experiments.sh first`);
  process.exit(1);
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

const meta = {
  generatedAt: new Date().toISOString(),
  replicates: manifest.replicates,
  horizon: manifest.horizon,
  grid: [manifest.studyParams[manifest.experiments[0].x].values.length,
         manifest.studyParams[manifest.experiments[0].y].values.length],
  manifest: MANIFEST_PATH,
  resultsDir: RESULTS_DIR,
  metrics: METRICS,
  domains,
};

const templatePath = path.join(ROOT, "report.template.html");
const outPath = path.join(ROOT, OUT_PATH);
const template = fs.readFileSync(templatePath, "utf8");
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
