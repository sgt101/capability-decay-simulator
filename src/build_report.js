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
const METRIC_SET = argOf("--metrics", "expertise");

const manifest = JSON.parse(fs.readFileSync(path.resolve(paths.DATA, MANIFEST_PATH), "utf8"));

// A metric may be a plain CSV column, or DERIVED from several via `from(row)`.
// `log: true` stores log10 of the aggregated value — capability runs from thousands
// to millions, and on a linear ramp every cell but the largest collapses to one shade.
const METRIC_SETS = {
  expertise: [
    { key: "meanE_shortfall", label: "Mean expertise shortfall (E)" },
    { key: "shareExpert_shortfall", label: "Expert-share shortfall" },
    { key: "meanE_baseline", label: "Mean E — no-AI baseline" },
    { key: "meanE_treatment", label: "Mean E — with AI" },
    { key: "shareExpert_baseline", label: "Expert share — no-AI baseline" },
    { key: "shareExpert_treatment", label: "Expert share — with AI" },
  ],
  capability: [
    // The headline, and derived rather than taken raw for a reason: the absolute
    // shortfall is in expert-equivalents, and cells differ several-fold in how much
    // capability they hold at all — a structure sweep would then colour by how big the
    // field is rather than by how much of it AI cost. The FRACTION is comparable across
    // every cell in the grid.
    { key: "capabilityLostFrac", label: "Share of capability lost to AI",
      from: (r) => { const b = num(r.systemCapability_baseline), t = num(r.systemCapability_treatment);
        return b && b > 0 && t != null ? 1 - t / b : null; } },
    { key: "systemCapability_shortfall", label: "Capability shortfall (expert-equivalents)" },
    { key: "systemCapability_baseline", label: "Capability — no-AI baseline (log₁₀)", log: true },
    { key: "systemCapability_treatment", label: "Capability — with AI (log₁₀)", log: true },
    // What the humans alone are worth in the AI arm: the field after AI has eroded it,
    // with the multiplier taken back off. The gap to the row above is the leverage.
    { key: "systemCapabilityHuman_treatment", label: "Capability — humans alone, under AI (log₁₀)", log: true },
    { key: "aiLeverage", label: "AI leverage (× over unaugmented)",
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
      const def = METRIC_BY_KEY.get(k);
      const v = def.from ? def.from(row) : num(row[k]);
      if (v == null || !Number.isFinite(v)) continue;
      sums[k][p] += v;
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
  console.error(`\n[build_report] MANIFEST/RESULTS MISMATCH — ${degenerate.length} experiment(s) in ${RESULTS_DIR}/ do not match ${MANIFEST_PATH}:\n`);
  degenerate.forEach((d) =>
    console.error(`  ${STEM}.${d.n}: manifest says ${d.xKey} x ${d.yKey}` +
      (d.nx !== undefined ? ` but the CSV has ${d.nx} and ${d.ny} distinct value(s)` : "") + ` — ${d.why}`));
  // Two different causes, two different fixes, so both are offered rather than
  // guessing which one applies.
  const stale = degenerate.some((d) => /stale results/.test(d.why));
  if (stale) {
    console.error(`\n  The axis was REGENERATED since these were run. Delete the affected results and`);
    console.error(`  re-run just those — the rest will be skipped as already complete:`);
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
  grid: [manifest.studyParams[manifest.experiments[0].x].values.length,
         manifest.studyParams[manifest.experiments[0].y].values.length],
  manifest: MANIFEST_PATH,
  resultsDir: RESULTS_DIR,
  metrics: METRICS,
  domains,
};

const templatePath = paths.src("report.template.html");
const outPath = path.resolve(paths.DOC, OUT_PATH);
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
