#!/usr/bin/env node
// Where is AI a net gain in capability? A sweep over (g_n, g_x, d_n) x rho.
//
//   node src/acl_leverage_sweep.js --snapshots results/acl-leverage/acl.1 [options]
//
// Reads the expertise snapshots acl_snapshots.js wrote and asks, for every combination of
// the three Dell'Acqua leverage parameters and every rho in a range, whether system
// capability under AI is above or below the no-AI arm at the reported year. Simulates
// nothing: the snapshots already contain every population the question needs.
//
// THE ARITHMETIC THAT MAKES THIS CHEAP. From engine.js aclLeverage,
//
//   l(E) = F*alpha(E) + (1 - F)*beta(E),  F = aiLevel^b,  m(E) = 1/(1 + e^(s(E - aiLevel)))
//   alpha = 1 + g_x + (g_n - g_x)*m,      beta  = 1 - d_n*m
//
// which regroups exactly, with no approximation, into
//
//   l(E) = A + B*m(E),   A = 1 + F*g_x,   B = F*(g_n - g_x) - (1 - F)*d_n
//
// so capability is linear in the three parameters:
//
//   C = A*sum_i w(E_i) + B*sum_i w(E_i) m(E_i)
//     = sum(w) + g_x*F*sum(w) + (g_n - g_x)*F*sum(w m) - d_n*(1 - F)*sum(w m).
//
// F and m depend on the run's own aiLevel, not on the three parameters, so the four sums
// are computed ONCE per (run, rho) and averaged over replicates into four coefficients
// per (cell, rho). After that every parameter point is four multiplications:
//
//   change% = 100 * (q0 + g_x*q1 + (g_n - g_x)*q2 - d_n*q3)
//
// WHY ONE SNAPSHOT COVERS SEVERAL PUBLISHED CONFIGS. The ACL family's fifteen configs differ
// in only four settings: the three leverage parameters, which this sweep varies and which
// never touch a career, and aiDampeningAbove, which does. So acl.1, acl.6 and acl.11 are the
// same simulation read out at three different parameter points — 0.43/0.17/0.19, 0.15/0.05/0.4
// and 0/0/0 — and one snapshot per dampening level serves all three. Those three points are
// pinned onto the grid by default (--include) rather than left to fall between grid lines, so
// each published parameterisation is reproduced exactly and marked on the page.
//
// Two consequences worth stating. Because the map is linear, the page can carry the
// coefficients and recompute everything live rather than shipping a precomputed grid — every
// parameter becomes a control. And capability is strictly DECREASING in d_n (q3 >= 0, being
// a sum of positive weights) and increasing in g_n, so the value plotted over those two axes
// is a smooth monotone sheet crossing its reference plane exactly once along any line: the
// sign boundary reads off the figure as a single contour rather than a scatter of islands.
//
// Options:
//   --snapshots DIR    a directory written by acl_snapshots.js (required)
//   --rho MIN,MAX      rho range, default 60,800
//   --rho-steps N      log-spaced values across it, default 25 (endpoints always kept)
//   --gn / --gx / --dn MIN:MAX:STEPS   grid per axis, default 0:0.8:9
//   --include LIST     extra parameter points to pin onto the grid and mark on the page,
//                      as "g_n,g_x,d_n" triples separated by ";". Default: the three
//                      parameterisations the ACL family publishes. See below for why.
//   --out DIR          default: the snapshots directory
//   --verify PATH      a rho_summary.json to check the shipped point against
//                      (default: results/rho/<config>/rho_summary.json if it exists)
//   --strict           make a failed verification a non-zero exit
"use strict";
const fs = require("fs");
const path = require("path");
const engine = require("./engine.js");
const paths = require("./paths.js");

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
function die(msg) { console.error("[acl] " + msg); process.exit(1); }

const SNAP_DIR = arg("snapshots");
if (!SNAP_DIR) {
  console.error("usage: node src/acl_leverage_sweep.js --snapshots results/acl-leverage/acl.1");
  console.error("       [--rho 60,800] [--rho-steps 25] [--gn 0:0.8:9] [--gx 0:0.8:9] [--dn 0:0.8:9]");
  console.error("       [--out DIR] [--verify results/rho/acl.1/rho_summary.json] [--strict]");
  process.exit(1);
}
const indexPath = path.join(SNAP_DIR, "snapshots.json");
if (!fs.existsSync(indexPath)) die(`${indexPath} not found — run src/acl_snapshots.js first`);
const snap = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const OUT = arg("out", SNAP_DIR);
const STRICT = process.argv.includes("--strict");

// The snapshot must have been taken under the same frontier shape the sweep assumes:
// F = aiLevel^frontierBreadth and the blend sharpness are baked into the m and F used
// below, and a snapshot taken under different ones describes a different model. They are
// recorded in snapshots.json precisely so this can be checked rather than hoped for.
const BREADTH = snap.frontierBreadth;
const SHARPNESS = snap.aclBlendSharpness;
const THETA = snap.theta;
if (!(BREADTH > 0) || !(SHARPNESS > 0) || !(THETA > 0 && THETA < 1)) {
  die("snapshots.json is missing frontierBreadth / aclBlendSharpness / theta — re-run src/acl_snapshots.js");
}
if (THETA !== engine.EXPERT_THRESHOLD) {
  die(`snapshot was taken at theta ${THETA}, engine.js is now ${engine.EXPERT_THRESHOLD} — re-run src/acl_snapshots.js`);
}

/* ------------------------------------- the grid -------------------------------------- */
// "MIN:MAX:STEPS", with the shipped value inserted so the published parameterisation is a
// grid point and not an interpolation between two.
function axis(spec, pin, label) {
  const m = /^(-?[\d.]+):(-?[\d.]+):(\d+)$/.exec(spec);
  if (!m) die(`--${label} must look like MIN:MAX:STEPS, got "${spec}"`);
  const lo = +m[1], hi = +m[2], n = +m[3];
  if (!(hi > lo) || n < 2) die(`--${label} needs MAX > MIN and STEPS >= 2, got "${spec}"`);
  const vals = [];
  for (let i = 0; i < n; i++) vals.push(lo + (hi - lo) * i / (n - 1));
  // Pinned values outside the axis are dropped rather than extending it: the range is the
  // reader's choice, and silently widening it would relabel their chart.
  pin.forEach((v) => { if (v >= lo && v <= hi) vals.push(v); });
  // Rounded to 6dp before de-duplicating: the loop above produces values like
  // 0.30000000000000004, which would otherwise sit beside a hand-written 0.3 as two
  // distinct grid points a reader cannot tell apart.
  return Array.from(new Set(vals.map((v) => +v.toFixed(6)))).sort((a, b) => a - b);
}
// Extra points pinned onto the grid. The snapshot's own parameterisation is always one of
// them: a page whose highlighted row sat 0.03 from the values the study actually published
// would be answering a slightly different question than the one asked.
const INCLUDE = [[snap.shipped.g_n, snap.shipped.g_x, snap.shipped.d_n]];
arg("include", "0.43,0.17,0.19;0.15,0.05,0.4;0,0,0").split(";").forEach((t) => {
  if (!t.trim()) return;
  const f = t.split(",").map(Number);
  if (f.length !== 3 || f.some((x) => !Number.isFinite(x))) {
    die(`--include wants "g_n,g_x,d_n" triples separated by ";", got "${t}"`);
  }
  INCLUDE.push(f);
});
const GN = axis(arg("gn", "0:0.8:9"), INCLUDE.map((t) => t[0]), "gn");
const GX = axis(arg("gx", "0:0.8:9"), INCLUDE.map((t) => t[1]), "gx");
const DN = axis(arg("dn", "0:0.8:9"), INCLUDE.map((t) => t[2]), "dn");

// De-duplicated and labelled once, for the page's markers and the summary. The
// snapshot's own values are the primary mark: that is the parameterisation this
// experiment was published under, and the others are context beside it.
const MARKS = [];
INCLUDE.forEach((t) => {
  const key = t.map((x) => +x.toFixed(6)).join(",");
  if (MARKS.some((m) => m.key === key)) return;
  const primary = t[0] === snap.shipped.g_n && t[1] === snap.shipped.g_x && t[2] === snap.shipped.d_n;
  MARKS.push({ key, g_n: +t[0].toFixed(6), g_x: +t[1].toFixed(6), d_n: +t[2].toFixed(6), primary });
});

// Log-spaced rho. Log, not linear: w is exponential in E with slope proportional to
// log(rho), so the capability curve is smooth in log(rho) and bunched in rho — the same
// reason rho_sensitivity.js interpolates its crossover there.
const rhoRange = arg("rho", "60,800").split(",").map(Number);
if (rhoRange.length !== 2 || !(rhoRange[0] > 0) || !(rhoRange[1] > rhoRange[0])) {
  die(`--rho must be MIN,MAX with 0 < MIN < MAX, got "${arg("rho", "60,800")}"`);
}
const RHO_STEPS = parseInt(arg("rho-steps", "25"), 10);
if (!Number.isInteger(RHO_STEPS) || RHO_STEPS < 2) die("--rho-steps must be an integer >= 2");
const RHOS = [];
for (let i = 0; i < RHO_STEPS; i++) {
  const f = i / (RHO_STEPS - 1);
  RHOS.push(+Math.exp(Math.log(rhoRange[0]) + f * (Math.log(rhoRange[1]) - Math.log(rhoRange[0]))).toFixed(3));
}

/* ------------------------- per-run sums, then per-cell coefficients ------------------- */
// Loaded as one Float32Array view over the whole file — no per-run allocation, and the
// subarray() calls below are views, not copies.
const bin = fs.readFileSync(path.join(SNAP_DIR, snap.expertiseFile));
if (bin.byteLength !== snap.values * 4) {
  die(`${snap.expertiseFile} is ${bin.byteLength} bytes, snapshots.json describes ${snap.values * 4}`
    + " — the two are out of step, re-run src/acl_snapshots.js");
}
const ALL_E = new Float32Array(bin.buffer, bin.byteOffset, snap.values);

// For one run: sum(w) and sum(w*m) at every rho in `rhos`. w is written exp(k(E - theta))
// with k = ln(rho)/(1 - theta), identical to rho^((E-theta)/(1-theta)) but one exp() per
// person per rho instead of a pow().
function runSums(rec, rhos) {
  const E = ALL_E.subarray(rec.offset, rec.offset + rec.n);
  const ks = rhos.map((r) => Math.log(r) / (1 - THETA));
  const S0 = new Float64Array(rhos.length), S1 = new Float64Array(rhos.length);
  const aiOn = rec.aiLevel !== null && rec.aiLevel !== undefined;
  for (let i = 0; i < E.length; i++) {
    const e = E[i] - THETA;
    // m is the share of this person's work the AI outranks: 1 well below it, 0 well
    // above. Independent of rho, so it is computed once per person.
    const m = aiOn ? 1 / (1 + Math.exp(SHARPNESS * (E[i] - rec.aiLevel))) : 0;
    for (let q = 0; q < ks.length; q++) {
      const w = Math.exp(ks[q] * e);
      S0[q] += w;
      if (m) S1[q] += w * m;
    }
  }
  return { S0, S1, F: aiOn ? Math.pow(rec.aiLevel, BREADTH) : 0 };
}

const TREAT_ARM = snap.arms.includes("treatment") ? "treatment" : "single";
const PAIRED = snap.arms.includes("baseline");
if (!PAIRED) {
  die("this snapshot has no baseline arm. \"Is capability positive?\" is a comparison against"
    + " the no-AI arm, and an unpaired config has nothing to compare to.");
}

console.log(`[acl] ${snap.config}: ${snap.cells} cell(s) x ${snap.replicates} replicate(s), tick ${snap.tick}`);
console.log(`[acl] rho ${rhoRange[0]}..${rhoRange[1]} in ${RHOS.length} log steps`);
console.log(`[acl] grid g_n x g_x x d_n = ${GN.length} x ${GX.length} x ${DN.length} = ${GN.length * GX.length * DN.length} points`);
console.log(`[acl] pinned on the grid: ${MARKS.map((m) => "(" + [m.g_n, m.g_x, m.d_n].join(", ") + ")" + (m.primary ? " <- this config" : "")).join(", ")}`);
console.log(`[acl] reading ${snap.runs.length} snapshots (${(snap.values * 4 / 1e6).toFixed(1)} MB)`);

// Four coefficients per (cell, rho), each already divided by the cell's baseline
// capability, so a change is 100*(q0 + g_x*q1 + (g_n - g_x)*q2 - d_n*q3) per cent.
// Kept as a function of the rho ladder so verify() can reuse it against the published
// report's own ladder instead of duplicating the reduction.
function cellCoefs(ci, rhos) {
  const treat = snap.runs.filter((r) => r.comboIndex === ci && r.arm === TREAT_ARM);
  const basel = snap.runs.filter((r) => r.comboIndex === ci && r.arm === "baseline");
  if (!treat.length || !basel.length) die(`cell ${ci} is missing an arm in snapshots.json`);
  const Q = rhos.length;
  const P0 = new Float64Array(Q), P1 = new Float64Array(Q), P2 = new Float64Array(Q),
    P3 = new Float64Array(Q), CB = new Float64Array(Q);
  treat.forEach((rec) => {
    const { S0, S1, F } = runSums(rec, rhos);
    for (let q = 0; q < Q; q++) {
      P0[q] += S0[q] / treat.length;
      P1[q] += F * S0[q] / treat.length;
      P2[q] += F * S1[q] / treat.length;
      P3[q] += (1 - F) * S1[q] / treat.length;
    }
  });
  // The reference arm runs with AI off, so l == 1 and its capability is sum(w) alone —
  // the leverage parameters cannot move it. That is what makes the comparison meaningful:
  // only one side of it depends on the three numbers being swept.
  basel.forEach((rec) => {
    const { S0 } = runSums(rec, rhos);
    for (let q = 0; q < Q; q++) CB[q] += S0[q] / basel.length;
  });
  const coef = [];
  for (let q = 0; q < Q; q++) {
    coef.push([(P0[q] - CB[q]) / CB[q], P1[q] / CB[q], P2[q] / CB[q], P3[q] / CB[q]]);
  }
  return {
    combo: treat[0].combo,
    meanE_t: treat.reduce((s2, r) => s2 + r.meanE, 0) / treat.length,
    meanE_b: basel.reduce((s2, r) => s2 + r.meanE, 0) / basel.length,
    coef,
    // The no-AI arm's capability itself, in threshold-expert equivalents. The coefficients
    // above are all ratios to it, which is the right form for a comparison but throws away
    // the levels — and "how much capability, against how much without AI" is the question
    // the charts are actually asked. Carried so both readings are available from one file.
    cb: Array.from(CB),
  };
}

const cells = [];
for (let ci = 0; ci < snap.cells; ci++) {
  cells.push(cellCoefs(ci, RHOS));
  if ((ci + 1) % 6 === 0 || ci + 1 === snap.cells) console.log(`[acl] ${ci + 1}/${snap.cells} cells reduced`);
}

/* ---------------------------- evaluation (the whole model) --------------------------- */
const changePct = (c, q, gn, gx, dn) => {
  const k = c.coef[q];
  return 100 * (k[0] + gx * k[1] + (gn - gx) * k[2] - dn * k[3]);
};
// True median, matching rho_sensitivity.js: the middle value for odd n, the mean of the
// middle two for even n. Every cell count in this study is even, so the distinction is
// live in every number below, not an edge case.
function median(a) {
  const f = a.filter(Number.isFinite).sort((x, y) => x - y), n = f.length;
  if (!n) return NaN;
  return n % 2 ? f[(n - 1) / 2] : (f[n / 2 - 1] + f[n / 2]) / 2;
}
const medianChange = (q, gn, gx, dn) => median(cells.map((c) => changePct(c, q, gn, gx, dn)));
// Capability itself, with AI and without. The reference is the median no-AI arm; the AI
// level is that reference moved by the median change.
//
// NOT the median of the AI levels taken independently. The experiment is paired — every
// cell compares against its own no-AI arm — so the measured quantity is the per-cell
// change, and its median is what every other number in this study reports. Taking two
// medians separately would produce a pair whose ratio is some third number that is neither,
// and a chart drawing both would then contradict itself: a surface plotted at one height
// and coloured by a different comparison. One measured quantity, one reference level,
// levels derived from them.
const medianCapNoAI = (q) => median(cells.map((c) => c.cb[q]));
const medianCapAI = (q, gn, gx, dn) => medianCapNoAI(q) * (1 + medianChange(q, gn, gx, dn) / 100);

// The rho at which a series crosses zero, interpolated in log(rho) — the same definition
// and the same interpolation rho_sensitivity.js uses, so a crossover here is comparable
// to one there. null when the sign never changes across the swept range.
function crossover(series) {
  for (let q = 1; q < series.length; q++) {
    const a = series[q - 1], b = series[q];
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
    if ((a < 0) === (b < 0)) continue;
    const f = -a / (b - a);
    return Math.exp(Math.log(RHOS[q - 1]) + f * (Math.log(RHOS[q]) - Math.log(RHOS[q - 1])));
  }
  return null;
}

/* ----------------------------------- CSV + summary ----------------------------------- */
fs.mkdirSync(OUT, { recursive: true });
const num = (v, dp) => (Number.isFinite(v) ? v.toFixed(dp) : "");

// Long form: one row per grid point per rho. Everything the page shows can be rebuilt
// from this without the snapshots, which is what makes the figures checkable by hand.
const gridLines = ["g_n,g_x,d_n,rho,medianChangePct,medianCapabilityAI,medianCapabilityNoAI,cellsPositive,cells"];
// Wide form: one row per grid point, carrying the sign verdict across the whole rho range.
const surfLines = ["g_n,g_x,d_n,verdict,crossoverRho,medianChangeAtRhoMin,medianChangeAtRhoMax,cellsFlippingSign"];
let nPosAll = 0, nNegAll = 0, nFlip = 0;
for (const gn of GN) for (const gx of GX) for (const dn of DN) {
  const series = RHOS.map((_, q) => medianChange(q, gn, gx, dn));
  RHOS.forEach((r, q) => {
    const pos = cells.filter((c) => changePct(c, q, gn, gx, dn) > 0).length;
    gridLines.push([num(gn, 4), num(gx, 4), num(dn, 4), r, num(series[q], 4),
      medianCapAI(q, gn, gx, dn).toExponential(6), medianCapNoAI(q).toExponential(6),
      pos, cells.length].join(","));
  });
  const cross = crossover(series);
  const cellFlips = cells.filter((c) => crossover(RHOS.map((_, q) => changePct(c, q, gn, gx, dn))) !== null).length;
  const verdict = cross !== null ? "flips" : (series[0] > 0 ? "positive" : "negative");
  if (verdict === "flips") nFlip++; else if (verdict === "positive") nPosAll++; else nNegAll++;
  surfLines.push([num(gn, 4), num(gx, 4), num(dn, 4), verdict, num(cross, 2),
    num(series[0], 4), num(series[series.length - 1], 4), cellFlips].join(","));
}
fs.writeFileSync(path.join(OUT, "acl_grid.csv"), gridLines.join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "acl_surface.csv"), surfLines.join("\n") + "\n");

const sh = snap.shipped;
const shippedSeries = RHOS.map((_, q) => medianChange(q, sh.g_n, sh.g_x, sh.d_n));

/* ----------------------------------- verification ------------------------------------ */
// Step 3 of the plan: at the shipped parameters the sweep must reproduce the numbers the
// published rho report already contains. It is the same engine, the same configs and the
// same seeds, so agreement should be to floating point, not merely close — and the one
// deliberate difference, Float32 snapshots against the report's Float64 in-process sums,
// is worth a few parts in 10^7 and nothing more.
//
// The comparison only means anything when the two ran the same cells with the same
// replicates: a report built on 32 replicates and a snapshot on 10 are different
// estimates of the same quantity and would differ for an uninteresting reason.
function verify() {
  const guess = path.join(paths.RESULTS, "rho", path.basename(snap.config, ".json"), "rho_summary.json");
  const vPath = arg("verify", fs.existsSync(guess) ? guess : null);
  if (!vPath) return { state: "skipped", why: "no rho_summary.json was given or found" };
  if (!fs.existsSync(vPath)) return { state: "skipped", why: `${vPath} does not exist` };
  const ref = JSON.parse(fs.readFileSync(vPath, "utf8"));
  const rel = path.relative(paths.ROOT, vPath);
  if (ref.replicates !== snap.replicates || ref.stride !== snap.stride || ref.tick !== snap.tick) {
    return { state: "skipped", file: rel,
      why: `${rel} used ${ref.replicates} replicate(s) / stride ${ref.stride} / tick ${ref.tick};`
        + ` this snapshot has ${snap.replicates} / ${snap.stride} / ${snap.tick}.`
        + " Re-take the snapshot with matching settings for an exact check." };
  }
  // The reference reports medianChange at its own rho ladder, which is not this sweep's
  // 60..800 range. Recomputed here at exactly those rho, from the same coefficients, so
  // the check is against the published numbers rather than against interpolations of them.
  // The reference reports medianChange at its own rho ladder, which is not this sweep's
  // 60..800 range. Recomputed here at exactly those rho, from the same reduction, so the
  // check is against the published numbers rather than against interpolations of them.
  const refRhos = ref.rhos.filter((r, i) => Number.isFinite(ref.medianChange[i]));
  const refCells = [];
  for (let ci = 0; ci < cells.length; ci++) refCells.push(cellCoefs(ci, refRhos));
  const rows = [];
  let worst = 0;
  refRhos.forEach((r, q) => {
    const expect = ref.medianChange[ref.rhos.indexOf(r)];
    const got = median(refCells.map((c) => {
      const k = c.coef[q];
      return 100 * (k[0] + sh.g_x * k[1] + (sh.g_n - sh.g_x) * k[2] - sh.d_n * k[3]);
    }));
    const relErr = Math.abs(got - expect) / Math.max(1e-12, Math.abs(expect));
    worst = Math.max(worst, relErr);
    rows.push({ rho: r, expect, got, relErr });
  });
  const TOL = 1e-5;
  return { state: worst <= TOL ? "pass" : "fail", file: rel, tol: TOL, worst, rows };
}
const verification = verify();

const summary = {
  config: snap.config, snapshots: path.relative(paths.ROOT, SNAP_DIR),
  cells: cells.length, replicates: snap.replicates, tick: snap.tick, stride: snap.stride,
  axes: snap.axes,
  rhoRange, rhos: RHOS, grid: { g_n: GN, g_x: GX, d_n: DN },
  frontierBreadth: BREADTH, aclBlendSharpness: SHARPNESS, theta: THETA,
  shipped: sh, shippedRho: snap.shippedRho, marks: MARKS,
  shippedMedianChange: shippedSeries,
  shippedCrossover: crossover(shippedSeries),
  points: GN.length * GX.length * DN.length,
  positiveAtEveryRho: nPosAll, negativeAtEveryRho: nNegAll, flipsInRange: nFlip,
  verification,
  generated: new Date().toISOString().slice(0, 10),
  report: "acl_leverage.html",
};
fs.writeFileSync(path.join(OUT, "acl_summary.json"), JSON.stringify(summary, null, 2));

/* -------------------------------------- the page ------------------------------------- */
const { writePage } = require("./acl_leverage_page.js");
writePage({ out: OUT, snap, summary, cells, RHOS, GN, GX, DN, MARKS });

const rel = path.relative(paths.ROOT, OUT);
console.log(`\n[acl] ${nPosAll} point(s) positive at every rho, ${nNegAll} negative at every rho, ${nFlip} flip inside ${rhoRange[0]}..${rhoRange[1]}`);
if (verification.state === "pass") {
  console.log(`[acl] verification PASSED against ${verification.file} (worst relative difference ${verification.worst.toExponential(2)})`);
} else if (verification.state === "fail") {
  console.error(`[acl] verification FAILED against ${verification.file}:`);
  verification.rows.filter((r) => r.relErr > verification.tol).slice(0, 8).forEach((r) =>
    console.error(`  rho ${r.rho}: report ${r.expect.toFixed(4)}%, sweep ${r.got.toFixed(4)}% (rel ${r.relErr.toExponential(2)})`));
} else {
  console.log(`[acl] verification skipped — ${verification.why}`);
}
console.log(`[acl] wrote ${rel}/acl_grid.csv, ${rel}/acl_surface.csv, ${rel}/acl_summary.json`);
console.log(`[acl] wrote ${rel}/acl_leverage.html   <- open this`);
if (STRICT && verification.state === "fail") process.exit(2);
