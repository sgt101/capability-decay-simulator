// Builds report.html — a self-contained, no-server heatmap browser over every
// experiment.N.json result. Reads results/experiment.N/results_shortfall.csv
// (already replicate-averaged... no, per-replicate — this script does the
// averaging), embeds one aggregated grid per experiment as JSON, and injects
// it into report.template.html. Rerun after any batch of experiments changes:
//
//   node build_report.js

"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "experiments.manifest.json"), "utf8"));

const METRICS = [
  { key: "meanE_shortfall", label: "Mean expertise shortfall (E)" },
  { key: "shareExpert_shortfall", label: "Expert-share shortfall" },
  { key: "meanC_shortfall", label: "Mean capability shortfall (C, observed)" },
  { key: "meanE_baseline", label: "Mean E — no-AI baseline" },
  { key: "meanE_treatment", label: "Mean E — with AI" },
  { key: "shareExpert_baseline", label: "Expert share — no-AI baseline" },
  { key: "shareExpert_treatment", label: "Expert share — with AI" },
  { key: "meanC_treatment", label: "Mean C — with AI (observed, AI-inflated)" },
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

function loadExperiment(entry) {
  const file = path.join(ROOT, "results", `experiment.${entry.n}`, "results_shortfall.csv");
  if (!fs.existsSync(file)) {
    console.error(`[build_report] skip experiment.${entry.n}: ${file} not found (run ./run_experiments.sh ${entry.n} first)`);
    return null;
  }
  const rows = parseCSV(fs.readFileSync(file, "utf8"));
  const xKey = entry.x, yKey = entry.y;

  // group by (x, y, t) — this collapses the replicate dimension via averaging
  const groups = new Map();
  for (const row of rows) {
    const x = num(row[xKey]), y = num(row[yKey]), t = num(row.t);
    const key = x + "|" + y + "|" + t;
    if (!groups.has(key)) groups.set(key, { x, y, t, rows: [] });
    groups.get(key).rows.push(row);
  }

  const cells = [];
  for (const g of groups.values()) {
    const cell = { x: g.x, y: g.y, t: g.t, n: g.rows.length };
    NUMERIC_METRIC_KEYS.forEach((k) => {
      const vals = g.rows.map((r) => num(r[k])).filter((v) => v != null);
      cell[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    cells.push(cell);
  }

  const xValues = [...new Set(cells.map((c) => c.x))].sort((a, b) => a - b);
  const yValues = [...new Set(cells.map((c) => c.y))].sort((a, b) => a - b);
  const ticks = [...new Set(cells.map((c) => c.t))].sort((a, b) => a - b);

  const fixed = Object.assign({}, manifest.baseFixed);
  Object.keys(manifest.studyParams).forEach((k) => {
    if (k !== xKey && k !== yKey) fixed[k] = manifest.studyParams[k].default;
  });

  return { n: entry.n, xKey, yKey, xValues, yValues, ticks, cells, fixed, runs: entry.runs };
}

const experiments = manifest.experiments.map(loadExperiment).filter(Boolean);

if (!experiments.length) {
  console.error("[build_report] no experiment results found under results/ — run ./run_experiments.sh first");
  process.exit(1);
}

// Global, stable color domain per metric — computed once across every loaded
// experiment/tick so switching experiments never rescales the color mapping
// out from under the viewer.
const domains = {};
NUMERIC_METRIC_KEYS.forEach((k) => {
  let min = Infinity, max = -Infinity;
  experiments.forEach((e) => e.cells.forEach((c) => {
    if (c[k] == null) return;
    if (c[k] < min) min = c[k];
    if (c[k] > max) max = c[k];
  }));
  domains[k] = [min, max];
});

const data = {
  generatedAt: new Date().toISOString(),
  replicates: manifest.replicates,
  horizon: manifest.horizon,
  metrics: METRICS,
  domains,
  experiments,
};

const templatePath = path.join(ROOT, "report.template.html");
const outPath = path.join(ROOT, "report.html");
const template = fs.readFileSync(templatePath, "utf8");
const placeholder = "/*__REPORT_DATA__*/";
if (!template.includes(placeholder)) throw new Error(`report.template.html is missing the ${placeholder} marker`);
const out = template.replace(placeholder, JSON.stringify(data));
fs.writeFileSync(outPath, out);

console.log(`[build_report] wrote report.html with ${experiments.length}/${manifest.experiments.length} experiments`);
if (experiments.length < manifest.experiments.length) {
  console.log(`[build_report] missing: ${manifest.experiments.filter((e) => !experiments.find((x) => x.n === e.n)).map((e) => e.n).join(", ")}`);
}
