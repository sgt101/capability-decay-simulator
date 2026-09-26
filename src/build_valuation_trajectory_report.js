// Builds doc/valuation_trajectories.html — capability trajectories for the three
// Dell'Acqua capability variants, with the PST and Barras valuation ranges drawn as
// shaded bands, plus the LaTeX tables of the series behind them.
//
//   node src/build_valuation_trajectory_report.js
//   node src/build_valuation_trajectory_report.js --from results/rho-trajectories
//   node src/build_valuation_trajectory_report.js --out valuation_trajectories.html
//
// WHAT THE FIGURE IS. Nine panels: columns are the capability variants (acl.2/7/12, all
// at gamma_above 0.0), rows the three measured Stromberg learning penalties. In each
// panel one band per valuation source spans that source's two value pools, so the band's
// width is how much the trajectory depends on which valuation you accept. It is a
// PARAMETER range and carries no probability; replicate scatter is a separate quantity
// and is reported in the summary table rather than drawn as the same kind of interval.
//
// WHY IT NEEDS --full-csv. rho_sensitivity.js computes capability at every recorded tick
// regardless, but by default WRITES only --at (the last one). A trajectory needs all 120,
// which is a write-time flag, not extra compute. A CSV with one distinct tick is the
// normal state of an ordinary rho sweep, so it is detected and named here rather than
// producing a chart with one point per line.
//
// WHY IT READS ITS OWN DIRECTORY. The default input is results/rho-trajectories/, not
// results/rho/. rho_sensitivity.js writes one directory per config and would overwrite
// whatever is already there, and results/rho/ holds the full rho LADDER — 21 values, the
// rank correlations and the crossover — which this report does not need and must not
// destroy. Separate directory, separate concern, and a failed run here cannot damage it.
//
// WHY THE NUMBERS ARE NOT IN THE TEMPLATE. Every series is derived from the CSVs at build
// time. A figure with numbers typed into it drifts from the run that produced them the
// first time either changes, which is the same reason build_pages.js derives its landing
// facts from the manifests instead of stating them.
"use strict";
const fs = require("fs");
const path = require("path");
const paths = require("./paths.js");

/* ----------------------------------------------------------------- what this set is */
// The three capability variants at gamma_above 0.0 — the slice on which the variants are
// comparable, which is why run_rho_sensitivity.sh picks the same three.
const CONFIGS = [2, 7, 12];
const MANIFEST = "experiments.acl.manifest.json";
const DEFAULT_FROM = path.join(paths.RESULTS, "rho-trajectories");
const DEFAULT_OUT = "valuation_trajectories.html";
const TEMPLATE = path.join(paths.SRC, "valuation_trajectories.template.html");

// Each source's two stated value pools, as capability ratios. rho is derived from the
// dollar figure, not the other way round: the pools are anchored linearly in w (what one
// top-percentile person is worth), and rho = w^(1/exponent) follows.
const SOURCES = [
  { name: "PST",    lo: { rho: 187, pool: "$400bn" }, hi: { rho: 735, pool: "$1.2Trn" } },
  { name: "Barras", lo: { rho: 66,  pool: "$400bn" }, hi: { rho: 263, pool: "$1.2Trn" } },
];
const SHIPPED = 1000;
const REQUIRED_RHOS = SOURCES.reduce((a, s) => a.concat([s.lo.rho, s.hi.rho]), []).concat([SHIPPED]);
// Checkpoints for the tables. 480 / 960 / 1440 are the career boundaries; 120 is a decade
// in, by which the switch-on transient has decayed.
const CHECKPOINTS = [120, 480, 960, 1440];
const TICKS_PER_YEAR = 12;

/* ------------------------------------------------------------------------- arguments */
function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const FROM = path.resolve(arg("from", DEFAULT_FROM));
const OUT = path.join(paths.DOC, arg("out", DEFAULT_OUT));
const TEX_DIR = path.resolve(arg("tex-dir", FROM));

const RUNNER = "./src/run_valuation_trajectories.sh";

function die(lines) {
  console.error("[build_valuation_trajectory_report] " + lines.join("\n  "));
  process.exit(1);
}

/* -------------------------------------------------------------------------- manifest */
const manifestPath = path.join(paths.DATA, MANIFEST);
if (!fs.existsSync(manifestPath)) {
  die([`no ${MANIFEST} — generate the set first:`, `node src/generate_acl_experiments.js`]);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const STROMBERG = manifest.stromberg;

/* ------------------------------------------------------------------------- csv input */
// Streamed line by line rather than split into an array of 2.9M strings: one config's
// full-tick CSV is ~50 MB at five rho and several times that at the ladder's twenty-one,
// and holding every line as a separate JS string is the difference between comfortable
// and a heap warning.
function readRuns(csvPath) {
  const text = fs.readFileSync(csvPath, "utf8");
  const nl = text.indexOf("\n");
  if (nl < 0) return null;
  const head = text.slice(0, nl).split(",");
  const ix = (n) => {
    const i = head.indexOf(n);
    if (i < 0) die([`${path.relative(paths.ROOT, csvPath)} has no "${n}" column —`,
      `it does not look like a rho_sensitivity.js run.`]);
    return i;
  };
  const C = { lam: ix("aiLevelFraction"), gb: ix("aiDampeningBelow"), arm: ix("arm"),
              rep: ix("replicate"), t: ix("t"), rho: ix("rho"), cap: ix("capability") };

  const paired = new Map();
  const rhos = new Set(), ticks = new Set(), gbs = new Set(), lams = new Set();
  let pos = nl + 1;
  while (pos < text.length) {
    let end = text.indexOf("\n", pos);
    if (end < 0) end = text.length;
    if (end > pos) {
      const f = text.slice(pos, end).split(",");
      const rho = +f[C.rho];
      // Rows for rho values this report does not plot are skipped here rather than
      // filtered later: at the ladder's twenty-one rho that is most of the file.
      if (REQUIRED_RHOS.indexOf(rho) >= 0) {
        const k = f[C.lam] + "|" + f[C.gb] + "|" + f[C.t] + "|" + rho + "|" + f[C.rep];
        let e = paired.get(k);
        if (!e) paired.set(k, (e = {}));
        e[f[C.arm]] = +f[C.cap];
        rhos.add(rho); gbs.add(+f[C.gb]); lams.add(+f[C.lam]);
      }
      ticks.add(+f[C.t]);
    }
    pos = end + 1;
  }
  return { paired, rhos, ticks, gbs, lams };
}

function median(a) {
  const s = a.slice().sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// ORDER OF OPERATIONS, and it matters:
//   1. pair treatment against baseline WITHIN a replicate — they share a seed, which is
//      what makes the paired spread far tighter than comparing two arm averages
//   2. average that ratio over the replicates          -> one value per (cell, tick, rho)
//   3. median over the lambda axis                     -> one value per (gb, tick, rho)
// Taking the median last keeps it a median of cell-level effects. A median capability
// first, then one ratio, is a different quantity and not the one the panels claim.
function summarise(runs, label) {
  const T = [...runs.ticks].sort((a, b) => a - b);
  const L = [...runs.lams].sort((a, b) => a - b);
  const G = [...runs.gbs].sort((a, b) => b - a);        // least severe penalty first

  const cell = new Map();                              // lam|gb|t|rho -> {sum,n}
  let replicates = 0;
  for (const [k, v] of runs.paired) {
    if (v.treatment === undefined || v.baseline === undefined) continue;
    const p = k.split("|");
    const kk = p[0] + "|" + p[1] + "|" + p[2] + "|" + p[3];
    let a = cell.get(kk);
    if (!a) cell.set(kk, (a = { sum: 0, sq: 0, n: 0 }));
    const pct = (v.treatment / v.baseline - 1) * 100;
    a.sum += pct; a.sq += pct * pct; a.n++;
    if (a.n > replicates) replicates = a.n;
  }

  const series = {}, spread = {};
  G.forEach((gb) => {
    series[gb] = {}; spread[gb] = {};
    [...runs.rhos].sort((a, b) => a - b).forEach((rho) => {
      series[gb][rho] = [];
      spread[gb][rho] = [];
      T.forEach((t) => {
        const vals = [], ses = [];
        L.forEach((lam) => {
          const a = cell.get(lam + "|" + gb + "|" + t + "|" + rho);
          if (!a) return;
          const mean = a.sum / a.n;
          vals.push(mean);
          // Paired SE across replicates for this cell, carried so the report can say
          // whether a band is wider than the noise inside it.
          const varr = a.n > 1 ? Math.max(0, (a.sq - a.n * mean * mean) / (a.n - 1)) : 0;
          ses.push(Math.sqrt(varr / Math.max(1, a.n)));
        });
        series[gb][rho].push(vals.length ? +median(vals).toFixed(4) : null);
        spread[gb][rho].push(ses.length ? +median(ses).toFixed(4) : null);
      });
    });
  });
  return { label, ticks: T, lambdas: L, gbs: G, rhos: [...runs.rhos].sort((a, b) => a - b),
           series, spread, replicates };
}

/* ------------------------------------------------------------------------ gather sets */
// FROM is the ROOT of the trajectory runs, and each SET beneath it is a directory holding a
// set.json plus one acl.N per config. A set is one value of gamma_above: the reported trio
// sits at 1.0, where the AI does not touch the learning of anybody above it, and a further
// set says what happens when it does. Each set describes itself in set.json rather than
// being inferred from its directory name or from a table kept here, so adding a gamma_above
// is a run plus a file, with nothing in this builder to update.
if (!fs.existsSync(FROM)) {
  die([`no ${path.relative(paths.ROOT, FROM)} — the trajectory sweep has not been run:`,
    `${RUNNER}`, ``,
    `It is a separate directory from results/rho/ on purpose: that one holds the rho`,
    `ladder, and re-running into it would overwrite those summaries.`]);
}

const problems = [];

function readSet(dir) {
  const setPath = path.join(dir, "set.json");
  if (!fs.existsSync(setPath)) return null;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(setPath, "utf8")); } catch (e) {
    problems.push(`${path.relative(paths.ROOT, setPath)} is not parseable JSON (${e.message})`);
    return null;
  }
  const need = ["key", "manifest", "aiDampeningAbove"];
  for (let i = 0; i < need.length; i++) {
    if (meta[need[i]] === undefined) {
      problems.push(`${path.relative(paths.ROOT, setPath)} has no "${need[i]}"`);
      return null;
    }
  }
  const mPath = path.join(paths.ROOT, meta.manifest);
  if (!fs.existsSync(mPath)) {
    problems.push(`${meta.key}: its manifest ${meta.manifest} does not exist`);
    return null;
  }
  const man = JSON.parse(fs.readFileSync(mPath, "utf8"));

  const configs = [];
  CONFIGS.forEach((n) => {
    const csvPath = path.join(dir, `acl.${n}`, "rho_runs.csv");
    const m = man.experiments.find((e) => e.n === n);
    if (!m) { problems.push(`${meta.key} acl.${n}: not in ${meta.manifest}`); return; }
    if (!fs.existsSync(csvPath)) {
      problems.push(`${meta.key} acl.${n}: no ${path.relative(paths.ROOT, csvPath)}`); return;
    }
    const runs = readRuns(csvPath);
    if (!runs) { problems.push(`${meta.key} acl.${n}: that CSV is empty`); return; }

    // The two failure modes worth naming separately, because each has its own fix.
    if (runs.ticks.size < 2) {
      problems.push(`${meta.key} acl.${n}: only tick ${[...runs.ticks][0]} was recorded`
        + ` — the sweep ran without --full-csv`);
      return;
    }
    const missingRho = REQUIRED_RHOS.filter((r) => !runs.rhos.has(r));
    if (missingRho.length) {
      problems.push(`${meta.key} acl.${n}: missing ρ ${missingRho.join(", ")}`
        + ` — the sweep ran with a different --rho list`);
      return;
    }
    const s = summarise(runs, m.label);
    s.n = n; s.variant = m.variant;
    configs.push(s);
  });
  if (!configs.length) return null;
  return {
    key: meta.key,
    aiDampeningAbove: meta.aiDampeningAbove,
    gammaAbove: meta.gammaAbove !== undefined ? meta.gammaAbove : +(meta.aiDampeningAbove - 1).toFixed(6),
    configs,
  };
}

const sets = fs.readdirSync(FROM, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => readSet(path.join(FROM, d.name)))
  .filter(Boolean)
  // Undampened first, so the page opens on the set the paper currently reports and any
  // further gamma_above reads as the departure from it.
  .sort((a, b) => b.aiDampeningAbove - a.aiDampeningAbove);

if (!sets.length) {
  die([`no usable set under ${path.relative(paths.ROOT, FROM)}:`]
    .concat(problems.length ? problems.map((p) => "- " + p) : ["- no subdirectory contains a set.json"])
    .concat([``, `Run the sweep and rebuild:`, `${RUNNER}`]));
}
sets.forEach((s) => {
  const c0 = s.configs[0];
  console.log(`  ${s.key}: γ_above ${s.aiDampeningAbove} — `
    + s.configs.map((c) => `acl.${c.n} ${c.variant}`).join(", "));
  console.log(`    ${c0.ticks.length} ticks, ρ ${c0.rhos.join(", ")}, ${c0.gbs.length} penalties,`
    + ` median over ${c0.lambdas.length} λ, n=${c0.replicates}`);
});
if (problems.length) {
  console.error(`[build_valuation_trajectory_report] ${problems.length} item(s) skipped:`);
  problems.forEach((p) => console.error("  - " + p));
}

// Every set has to describe the same figure, or the shared vertical scale and the selector
// would be comparing different things without saying so.
const refCfg = sets[0].configs[0];
sets.forEach((s) => s.configs.forEach((c) => {
  if (c.ticks.length !== refCfg.ticks.length || c.gbs.length !== refCfg.gbs.length) {
    die([`${s.key} acl.${c.n} has ${c.ticks.length} ticks and ${c.gbs.length} penalties, but`,
      `${sets[0].key} acl.${refCfg.n} has ${refCfg.ticks.length} and ${refCfg.gbs.length}.`,
      `The sets are meant to differ in γ_above ONLY — re-run them with the same flags.`]);
  }
}));

/* ------------------------------------------------------------------------- the tables */
// Minimal escaper, local by intent: build_report.js has one but does not export it, and a
// copy of four replaces() is cheaper than widening that module's surface. LaTeX is built
// here in Node rather than in the page's script for the reason build_report.js gives — a
// .tex file is mostly backslashes, and assembling one browser-side means every backslash
// surviving two levels of escaping.
function pctLabel(v) {
  // Text mode renders a plain "-" as a hyphen. The data columns use $-$, so the penalty
  // label has to as well or one table carries two different minus glyphs.
  return (v < 0 ? "$-$" : "") + Math.abs(v).toFixed(2) + "\\%";
}
function tex(s) {
  return String(s).replace(/\\/g, "\\textbackslash{}").replace(/([&%$#_{}])/g, "\\$1");
}
function num(v, d) {
  if (v === null || v === undefined || !isFinite(v)) return "--";
  return (v >= 0 ? "+" : "$-$") + Math.abs(v).toFixed(d === undefined ? 2 : d);
}
function idxOf(cfg, t) {
  let best = 0;
  cfg.ticks.forEach((x, i) => { if (Math.abs(x - t) < Math.abs(cfg.ticks[best] - t)) best = i; });
  return best;
}
function crossTick(cfg, gb, rho) {
  const s = cfg.series[gb][rho];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === null || s[i] >= 0) continue;
    let stays = true;
    for (let j = i; j < s.length; j++) if (s[j] !== null && s[j] >= 0) { stays = false; break; }
    if (stays) return cfg.ticks[i];
  }
  return null;
}

const VARIANT_SHORT = { published: "as published", weak: "weak", wrong: "wrong/no-effect" };

function cellsTex() {
  const cols = CHECKPOINTS.map((t) => idxOf(sets[0].configs[0], t));
  const L = [];
  L.push("% Band edges of the valuation ranges behind doc/valuation_trajectories.html.");
  L.push("% Generated by src/build_valuation_trajectory_report.js — do not edit by hand.");
  L.push("% Each cell is the low-pool to high-pool capability change, percent, median over lambda.");
  L.push("\\begin{tabular}{llll" + CHECKPOINTS.map(() => "r").join("") + "}");
  L.push("\\hline");
  L.push("$\\gamma_{above}$ & Scenario & Penalty & Source & "
    + CHECKPOINTS.map(function (t) { return "$t=" + t + "$"; }).join(" & ") + " \\\\");
  L.push("\\hline");
  sets.forEach((set) => { set.configs.forEach((cfg) => {
    cfg.gbs.forEach((gb, gi) => {
      SOURCES.forEach((src) => {
        const row = cols.map((i) => {
          const a = cfg.series[gb][src.lo.rho][i], b = cfg.series[gb][src.hi.rho][i];
          if (a === null || b === null) return "--";
          return `${num(Math.min(a, b), 1)} to ${num(Math.max(a, b), 1)}`;
        });
        L.push([String(set.aiDampeningAbove), tex(VARIANT_SHORT[cfg.variant] || cfg.variant),
          pctLabel(STROMBERG.statedPercent[gi]), tex(src.name)]
          .concat(row).join(" & ") + " \\\\");
      });
    });
  }); L.push("\\hline"); });
  L.push("\\end{tabular}");
  return L.join("\n") + "\n";
}

function summaryTex() {
  const last = sets[0].configs[0].ticks.length - 1;
  const L = [];
  L.push("% Per-panel summary of doc/valuation_trajectories.html.");
  L.push("% Generated by src/build_valuation_trajectory_report.js — do not edit by hand.");
  L.push("% Width is the end-of-horizon valuation range in percentage points; SE is the median");
  L.push("% paired replicate standard error over the same cells, so the two are comparable.");
  L.push("\\begin{tabular}{lllrrrr}");
  L.push("\\hline");
  L.push("$\\gamma_{above}$ & Scenario & Penalty & \\multicolumn{2}{c}{Width (pp)}"
    + " & \\multicolumn{2}{c}{Turns negative at $t$} \\\\");
  L.push(" & & & PST & Barras & PST & Barras \\\\");
  L.push("\\hline");
  sets.forEach((set) => { set.configs.forEach((cfg) => {
    cfg.gbs.forEach((gb, gi) => {
      const w = SOURCES.map((src) => {
        const a = cfg.series[gb][src.lo.rho][last], b = cfg.series[gb][src.hi.rho][last];
        return (a === null || b === null) ? "--" : Math.abs(a - b).toFixed(2);
      });
      const x = SOURCES.map((src) => {
        const c = crossTick(cfg, gb, src.hi.rho);
        return c === null ? "never" : String(c);
      });
      L.push([String(set.aiDampeningAbove), tex(VARIANT_SHORT[cfg.variant] || cfg.variant),
        pctLabel(STROMBERG.statedPercent[gi])]
        .concat(w).concat(x).join(" & ") + " \\\\");
    });
  }); L.push("\\hline"); });
  L.push("\\end{tabular}");
  return L.join("\n") + "\n";
}

/* -------------------------------------------------------------------------- emit */
if (!fs.existsSync(TEMPLATE)) {
  die([`no ${path.relative(paths.ROOT, TEMPLATE)} — the page template is missing.`]);
}

const texCells = cellsTex();
const texSummary = summaryTex();
fs.mkdirSync(TEX_DIR, { recursive: true });
const cellsPath = path.join(TEX_DIR, "valuation_trajectory_cells.tex");
const summaryPath = path.join(TEX_DIR, "valuation_trajectory_summary.tex");
fs.writeFileSync(cellsPath, texCells);
fs.writeFileSync(summaryPath, texSummary);

const payload = {
  generated: new Date().toISOString().slice(0, 10),
  source: path.relative(paths.ROOT, FROM),
  ticksPerYear: TICKS_PER_YEAR,
  checkpoints: CHECKPOINTS,
  stromberg: STROMBERG,
  sources: SOURCES,
  shipped: SHIPPED,
  sets: sets.map((s) => ({
    key: s.key, aiDampeningAbove: s.aiDampeningAbove, gammaAbove: s.gammaAbove,
    configs: s.configs.map((c) => ({
      n: c.n, label: c.label, variant: c.variant,
      ticks: c.ticks, lambdas: c.lambdas, gbs: c.gbs, rhos: c.rhos,
      series: c.series, spread: c.spread, replicates: c.replicates,
    })),
  })),
};

let html = fs.readFileSync(TEMPLATE, "utf8");
const marks = ["__TRAJ__", "__TEX_CELLS__", "__TEX_SUMMARY__"];
const absent = marks.filter((m) => !html.includes(m));
if (absent.length) {
  die([`${path.relative(paths.ROOT, TEMPLATE)} has no ${absent.join(", ")} placeholder —`,
    `the template and this builder have drifted apart.`]);
}
// JSON first, then the LaTeX: a </script> inside injected text would end the page's
// script block early, and the .tex bodies are the only injected content that is not
// JSON-escaped already.
const guard = (s) => s.replace(/<\//g, "<\\/");
html = html.replace("__TRAJ__", guard(JSON.stringify(payload)))
           .replace("__TEX_CELLS__", guard(JSON.stringify(texCells)))
           .replace("__TEX_SUMMARY__", guard(JSON.stringify(texSummary)));
const survived = marks.filter((m) => html.includes(m));
if (survived.length) die([`placeholder ${survived.join(", ")} survived substitution.`]);

fs.writeFileSync(OUT, html);

const nPanels = sets[0].configs.length * sets[0].configs[0].gbs.length;
console.log(`\nwrote ${path.relative(paths.ROOT, OUT)}  (${(html.length / 1024).toFixed(0)} KB, `
  + `${sets.length} \u03B3_above set(s) \u00D7 ${sets[0].configs.length} variant(s) `
  + `\u00D7 ${sets[0].configs[0].gbs.length} penalties = ${nPanels} panels per set)`);
console.log(`wrote ${path.relative(paths.ROOT, cellsPath)}`);
console.log(`wrote ${path.relative(paths.ROOT, summaryPath)}`);
