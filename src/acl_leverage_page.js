#!/usr/bin/env node
// The page acl_leverage_sweep.js writes: acl_leverage.html.
//
// Kept in its own file because the sweep is arithmetic and this is 700 lines of drawing;
// mixing them made neither reviewable. Exports one function, writePage().
//
// WHAT THE PAGE CARRIES. Not a rendered grid — the four coefficients per (cell, rho) and
// the identity change% = 100*(q0 + g_x*q1 + (g_n - g_x)*q2 - d_n*q3) (see the sweep's
// header for the derivation). That is about 1,800 numbers for an 18-cell config, and it
// makes every parameter a live control rather than a re-run: the page recomputes the whole
// map on a slider drag, and a reader can put the three parameters anywhere, not only on
// the grid the sweep happened to tabulate.
//
// WHAT IS ON THE VERTICAL AXIS. The quantity itself: the capability change against the
// no-AI arm, or capability in threshold-expert equivalents with the no-AI arm drawn as the
// reference surface. Not a derived summary of it. An earlier version of this page plotted
// the critical d_n at which the sign turns over — a defensible object, but it answered a
// question nobody asked and it hid the magnitudes, which are the thing worth seeing. The
// sign boundary is still there, where the surface meets its reference plane, which is
// where a reader will look for it anyway.
//
// Colour is diverging, because the quantity has a real zero with opposite meanings either
// side: two hues and a neutral grey midpoint, never a hue at the middle. The reserved
// status pair marks the published parameterisations, each with words beside it, and a
// table view carries every number the figures shade — so nothing is carried by colour
// alone.
"use strict";
const fs = require("fs");
const path = require("path");

/* -------------------------------------- styling -------------------------------------- */
// The same tokens report.template.html and rho_sensitivity.js define, including the
// three-state theme handling: a bare :root light palette, a prefers-color-scheme override
// guarded so an explicit light choice still wins, and a [data-theme] pair so a toggle wins
// in both directions. This page is opened beside those reports and should not look like a
// different study.
function css() {
  return `
:root{--bg:#eef0ee;--panel:#fff;--panel-2:#f4f5f3;--ink:#14181a;--ink-muted:#5c6360;--ink-faint:#8b918d;
--rule:#d7dad6;--accent:#a8502c;--accent2:#35636b;--warn:#a8502c;--shadow:0 1px 2px rgba(20,24,26,.07);
--surface-1:#fcfcfb}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#101314;--panel:#171b1d;--panel-2:#1d2224;
--ink:#e8eae6;--ink-muted:#93a09c;--ink-faint:#656e6b;--rule:#2b3234;--accent:#dd8259;--accent2:#7fb0b7;
--warn:#dd8259;--shadow:0 1px 3px rgba(0,0,0,.5);--surface-1:#1a1a19}}
:root[data-theme="dark"]{--bg:#101314;--panel:#171b1d;--panel-2:#1d2224;
--ink:#e8eae6;--ink-muted:#93a09c;--ink-faint:#656e6b;--rule:#2b3234;--accent:#dd8259;--accent2:#7fb0b7;
--warn:#dd8259;--shadow:0 1px 3px rgba(0,0,0,.5);--surface-1:#1a1a19}
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
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.86em}
.panel{background:var(--panel);border:1px solid var(--rule);border-radius:6px;box-shadow:var(--shadow);padding:1rem}
.head{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:.5rem;margin-bottom:.7rem}
.head .sub{font-size:.78rem;color:var(--ink-muted)}
.facts{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;color:var(--ink-faint)}
/* Filters in one row above the chart, per the interaction spec. */
.controls{display:flex;flex-wrap:wrap;gap:.8rem 1.2rem;align-items:center;padding:.6rem .1rem .9rem;
font-size:.78rem;color:var(--ink-muted)}
.controls label{display:inline-flex;align-items:center;gap:.4rem}
.controls .grp{display:inline-flex;align-items:center;gap:.5rem;padding:.25rem .55rem;border:1px solid var(--rule);
border-radius:4px;background:var(--panel-2)}
.controls input[type=range]{width:180px;accent-color:var(--accent2)}
.controls select,.controls input[type=number]{font:inherit;font-size:.78rem;color:var(--ink);background:var(--panel);
border:1px solid var(--rule);border-radius:3px;padding:.15rem .3rem}
.controls b{color:var(--ink);font-family:ui-monospace,monospace;font-weight:600}
.legend{display:flex;flex-wrap:wrap;gap:.5rem 1rem;font-size:.74rem;color:var(--ink-muted);margin:.6rem 0 0}
.legend .it{display:inline-flex;align-items:center;gap:.4rem}
.legend .sw{width:22px;height:10px;border-radius:2px;border:1px solid rgba(0,0,0,.18)}
.legend .ramp{width:86px;height:10px;border-radius:2px;border:1px solid rgba(0,0,0,.18)}
table.data-table{border-collapse:collapse;width:100%;font-size:.82rem}
table.data-table th,table.data-table td{border:1px solid var(--rule);padding:.3rem .5rem;text-align:right;
font-family:ui-monospace,monospace;white-space:nowrap}
table.data-table th:first-child,table.data-table td:first-child{text-align:left}
table.data-table th{background:var(--panel-2);font-weight:600}
table.data-table td.neg{color:var(--warn)}
table.data-table td.pos{color:#006300}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]) table.data-table td.pos{color:#7fd4a2}}
:root[data-theme="dark"] table.data-table td.pos{color:#7fd4a2}
table.data-table tr.ref td{background:var(--panel-2);font-weight:600}
.table-scroll{overflow:auto;max-height:460px}
.fig-toolbar{display:flex;gap:.4rem;align-items:center;justify-content:flex-end;margin:.35rem 0 0}
.copy-btn{display:inline-flex;align-items:center;gap:.4rem;padding:.28rem .6rem;font:inherit;font-size:.72rem;
color:var(--ink-muted);background:var(--panel-2);border:1px solid var(--rule);border-radius:4px;cursor:pointer}
.copy-btn:hover{color:var(--ink);border-color:var(--ink-faint)}
.copy-btn:active{transform:translateY(1px)}
.copy-btn.is-done{color:#2e7d4f;border-color:#2e7d4f}
.copy-btn.is-fail{color:#c0392b;border-color:#c0392b}
.copy-btn svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.8}
.canvas-wrap{position:relative;overflow-x:auto}
.canvas-wrap canvas{width:100%;min-width:460px;display:block;cursor:default}
#fig-cube{cursor:grab}
#fig-cube.dragging{cursor:grabbing}
.tip{position:absolute;pointer-events:none;opacity:0;transition:opacity .08s;background:var(--panel);
border:1px solid var(--rule);border-radius:4px;box-shadow:var(--shadow);padding:.4rem .55rem;font-size:.74rem;
line-height:1.45;color:var(--ink);white-space:nowrap;z-index:5}
.tip b{font-family:ui-monospace,monospace}
.figcap{margin:.7rem 0 0;padding-top:.6rem;border-top:1px solid var(--rule);font-size:.74rem;
line-height:1.55;color:var(--ink-muted)}
.key{background:var(--panel-2);border:1px solid var(--rule);border-left:3px solid var(--accent2);
padding:.85rem 1rem;border-radius:4px}
.key p{color:var(--ink-muted);max-width:none}
.key b{color:var(--ink)}
details.notes{padding:.7rem 1rem}
details.notes summary{cursor:pointer;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;
color:var(--ink-faint);list-style-position:outside}
details.notes summary:hover{color:var(--ink-muted)}
details.notes[open] summary{margin-bottom:.7rem}
details.notes ul{margin:0 0 .6rem;padding-left:1.1rem;color:var(--ink-muted);max-width:46rem}
details.notes li{margin-bottom:.35rem}
.verdict-ok{border-left-color:#0ca30c}
.verdict-bad{border-left-color:#d03b3b}
`;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function copyIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/>'
    + '<path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
}
function saveIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/>'
    + '<path d="M4 17v3h16v-3"/></svg>';
}
// A chart, its PNG controls and its tooltip host. Height is set here so the element does
// not jump when the client sizes the backing store on first draw.
function figureBlock(id, h, caption) {
  return `<div class="canvas-wrap"><canvas id="fig-${id}" style="height:${h}px"></canvas>
  <div class="tip" id="tip-${id}"></div></div>
<div class="fig-toolbar">
  <button class="copy-btn" data-fig="${id}" data-act="copy" type="button" title="Copy this figure to the clipboard as a PNG">${copyIcon()}<span>Copy PNG</span></button>
  <button class="copy-btn" data-fig="${id}" data-act="save" type="button" title="Save this figure as a PNG file">${saveIcon()}<span>Download PNG</span></button>
</div>
<p class="figcap">${caption}</p>`;
}

/* --------------------------------------- page ---------------------------------------- */
function writePage(ctx) {
  const { out, snap, summary, cells, RHOS, GN, GX, DN, MARKS, ANCHOR_E } = ctx;
  const sh = snap.shipped;
  const r0 = summary.rhoRange[0], r1 = summary.rhoRange[1];

  // Rounded before embedding: the coefficients carry far more digits than they mean, and
  // the page's arithmetic is a comparison against zero, not a published figure.
  const round = (v) => +v.toPrecision(8);
  // w at one expertise, for stating what a change in rho actually does. NOT a single
  // "rho means xN" claim: w(E) = rho^((E-theta)/(1-theta)) puts rho under a FRACTIONAL
  // exponent for everyone below the ceiling, so rho equals the multiple at E = 1 and at no
  // other point. An earlier version of this page labelled the control "top performer x800"
  // on that basis; it was wrong about everyone the study is actually about, since the
  // population sits well below the ceiling. The multiple a reader should picture depends on
  // whose expertise is being counted, so the prose states a spread across E and the control
  // says rho.
  const wAt = (E, rho) => Math.pow(rho, (E - snap.theta) / (1 - snap.theta));
  const wMark = (rho) => {
    const v = wAt(ANCHOR_E, rho);
    return "\u00d7" + (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(0) : v.toFixed(1));
  };
  const mult = (E, rho) => {
    const v = wAt(E, rho);
    return v >= 10 ? String(Math.round(v)) : String(+v.toFixed(1));
  };
  const DATA = {
    config: snap.config, tick: snap.tick, replicates: snap.replicates,
    axes: snap.axes, rhos: RHOS, rhoRange: [r0, r1],
    gn: GN, gx: GX, dn: DN, shipped: sh, shippedRho: snap.shippedRho, marks: MARKS,
    theta: snap.theta, breadth: snap.frontierBreadth, sharpness: snap.aclBlendSharpness,
    // The expertise the w readout is quoted at: the 99th percentile of this run's own
    // no-AI arm, measured by the sweep rather than chosen here. See anchorExpertise().
    anchorE: ANCHOR_E,
    // One entry per cell: the axis values that define it, coef[rho][0..3], and the no-AI
    // arm's own capability per rho. The coefficients give the comparison, cb gives the
    // levels both sides of it are measured on, and the page needs both.
    cells: cells.map((c) => ({
      combo: c.combo, dMeanE: round(c.meanE_t - c.meanE_b),
      coef: c.coef.map((k) => k.map(round)),
      cb: c.cb.map(round),
    })),
  };

  const v = summary.verification;
  const verifyPanel = (() => {
    if (v.state === "pass") {
      return `<div class="key verdict-ok"><h3>Verification</h3>
<p><b>Passed.</b> At the published leverage values (Novice Gain ${sh.g_n}, Expert Gain ${sh.g_x},
Novice Deficit ${sh.d_n}) this page reproduces every median capability change in
<code>${esc(v.file)}</code>, across all ${v.rows.length} &rho; values that report covers. Worst relative
difference ${v.worst.toExponential(2)} &mdash; the size expected from storing expertise as 32-bit
rather than 64-bit floats, and nothing more. The charts below are therefore the same
measurement as the published &rho; report, extended over the leverage parameters.</p></div>`;
    }
    if (v.state === "fail") {
      const bad = v.rows.filter((x) => x.relErr > v.tol).slice(0, 6)
        .map((x) => `&rho;&nbsp;${x.rho}: report ${x.expect.toFixed(3)}%, here ${x.got.toFixed(3)}%`).join("; ");
      return `<div class="key verdict-bad"><h3>Verification</h3>
<p><b>Failed.</b> At the published leverage values this page does not reproduce
<code>${esc(v.file)}</code>. Worst relative difference ${v.worst.toExponential(2)}, tolerance
${v.tol.toExponential(0)}. ${esc(bad)}. Treat every number on this page as unconfirmed until that is
explained: the two should be the same engine, the same configs and the same seeds.</p></div>`;
    }
    return `<div class="key"><h3>Verification</h3>
<p><b>Not run.</b> ${esc(v.why || "no reference was available")} Until it runs, nothing here has been
checked against the published &rho; report.</p></div>`;
  })();

  const body = `
<div class="panel">
  <div class="head">
    <h1>Where AI is a net gain in capability</h1>
    <span class="sub">${esc(snap.config)} &middot; tick ${snap.tick} &middot; generated ${esc(summary.generated)}</span>
  </div>
  <p>Does AI leave the system with more capability than it had without? The answer turns on three numbers
  from one study of one profession &mdash; <b>Novice Gain</b> (<code>g<sub>n</sub></code>), <b>Expert Gain</b>
  (<code>g<sub>x</sub></code>) and <b>Novice Deficit</b> (<code>d<sub>n</sub></code>) &mdash; and on
  <b>expert value</b> &mdash; what one person in the top 1% of the field is worth in threshold experts, swept
  from ${wMark(r0)} to ${wMark(r1)} (&rho; ${r0} to ${r1}). All four are controls below, not settings.</p>
  <p class="facts">${summary.cells} cells &times; ${summary.replicates} replicates, expertise snapshotted at tick ${snap.tick} &middot;
  axes ${esc(snap.axes.join(" x "))} &middot; &theta; = ${snap.theta} &middot; frontier breadth ${snap.frontierBreadth} &middot;
  blend sharpness ${snap.aclBlendSharpness} &middot; ${summary.rhos.length} log-spaced values of &rho; from
  ${r0} to ${r1} &middot; no simulation was run to draw this</p>
</div>

<details class="panel notes">
  <summary>What the four numbers are</summary>
  <ul>
    <li><b>Novice Gain</b> (<code>aclNoviceGain</code>) &mdash; output AI adds for weaker performers, on work
    inside its frontier.</li>
    <li><b>Expert Gain</b> (<code>aclExpertGain</code>) &mdash; the same for stronger performers. Smaller: AI
    levels the field rather than lifting it evenly.</li>
    <li><b>Novice Deficit</b> (<code>aclNoviceDeficit</code>) &mdash; output lost outside the frontier, by
    people who cannot tell the AI's work is wrong.</li>
    <li><b>Expert value</b> &mdash; the control is <code>w</code> at E = ${ANCHOR_E.toFixed(3)}, the 99th
    percentile of this run's own no-AI population, and &rho; follows from
    <code>&rho; = w<sup>(1&minus;&theta;)/(E&minus;&theta;)</sup></code>. One number shown two ways; both are
    on every readout, since &rho; is what the rest of the study and every CSV column is keyed to.
    <code>w</code> is not a single multiple for everyone: at ${wMark(r1)} for the top 1%, a person at the
    median counts ${mult(0.613, r1)} and the expert threshold counts 1. Note also that &rho; itself is never
    realised &mdash; <code>w(1) = &rho;</code> describes an E = 1 nobody in this population reaches. A stated
    assumption, never measured, which is why it is swept.</li>
  </ul>
  <p>None of the four touches a career &mdash; they are read off the population at the end of the run. That is
  why one run answers for three of the published configs at once, and why no simulation was needed to draw
  this page. Plotted values are medians across this experiment's ${summary.cells} cells, each against its own
  no-AI arm, from the same seeds. The treatment arm has already lost expertise to AI-dampened learning before
  any leverage applies; above zero means the leverage earned that back.</p>
</details>

<div class="panel">
  <div class="head"><h2>Capability, with AI and without</h2>
    <span class="sub">drag to rotate</span></div>
  <div class="controls">
    <span class="grp">
      <label><input type="radio" name="metric" value="change" checked> change vs no-AI (%)</label>
      <label><input type="radio" name="metric" value="level"> capability, both arms</label>
    </span>
    <label>Expert Gain <input type="range" id="gx-slider" min="0" max="${GX.length - 1}" value="${GX.indexOf(sh.g_x) < 0 ? 0 : GX.indexOf(sh.g_x)}"> <b id="gx-val">${sh.g_x}</b></label>
    <label title="what one person in the top 1% of the field (E = ${ANCHOR_E.toFixed(3)}) is worth, in threshold experts. Sets rho: w(E) = rho^((E-theta)/(1-theta))">expert value
      <input type="range" id="rho-slider" min="0" max="${RHOS.length - 1}" value="${RHOS.length - 1}">
      <b id="rho-val">${wMark(RHOS[RHOS.length - 1])}&nbsp; (&rho; ${RHOS[RHOS.length - 1]})</b></label>
    <label><input type="checkbox" id="show-bracket"> bracket ${wMark(r0)} and ${wMark(r1)}</label>
    <label><input type="checkbox" id="show-shipped" checked> mark the published parameterisations</label>
    <button class="copy-btn" id="reset-view" type="button">Reset view</button>
  </div>
  ${figureBlock("cube", 440,
    `The vertical axis is the quantity itself. In <b>change vs no-AI</b> it is the median capability change
     against each cell's own no-AI arm, in per cent, with the flat grey plane at zero: surface above the plane
     means AI left the system with more capability than it had without, below it means less. In <b>capability,
     both arms</b> it is capability in threshold-expert equivalents on a log scale, with the no-AI arm drawn as
     the flat reference surface &mdash; the same comparison, read as two levels rather than one ratio. Across
     the floor: <b>Novice Gain</b>, the in-frontier gain to weaker performers, and <b>Novice Deficit</b>, the
     loss outside the frontier. <b>Expert Gain</b> and <b>expert value</b> are the two sliders &mdash; the
     second sets how much a person in the top 1% of the field (E = ${ANCHOR_E.toFixed(3)}) is worth in
     threshold experts, which fixes &rho;.
     <b>Bracket</b> overlays the same surface at ${wMark(r0)} and ${wMark(r1)}, so the width of that gap is
     how much of the answer that one assumption is responsible for.`)}
  <div class="legend" id="cube-legend"></div>
</div>

<div class="panel">
  <div class="head"><h2>Cell by cell</h2>
    <span class="sub">one panel per Expert Gain, at the &rho; chosen above</span></div>
  ${figureBlock("panels", 300,
    `The same numbers read flat. Each square is one <b>Expert Gain</b>; within it, <b>Novice Gain</b> across
     and <b>Novice Deficit</b> up, shaded by the capability change against the no-AI arm &mdash; blue above zero, red below,
     neutral at zero. The heavier line is the zero contour: the boundary this whole study is about. Outlined
     cells are the published parameterisations.`)}
  <div class="legend" id="panel-legend"></div>
</div>

<div class="panel">
  <div class="head"><h2>The numbers</h2>
    <span class="sub">median capability change, per cent, against the no-AI arm</span></div>
  <div class="controls">
    <label>Expert Gain <select id="tbl-gx"></select></label>
    <label>expert value <select id="tbl-rho"></select></label>
    <label><input type="checkbox" id="tbl-levels"> show capability, not the change</label>
  </div>
  <div class="table-scroll" id="tbl-host"></div>
  <p class="figcap">Rows are Novice Gain, columns Novice Deficit. The published parameterisation is the
  highlighted row and is marked in the header. Positive means AI leaves the system with more capability than the
  no-AI arm at that &rho;; negative means less. Tick the box to read the two capability levels instead, as
  <code>with AI / without</code> in threshold-expert equivalents. This is the table view of both figures above
  &mdash; every shaded cell there has a number here.</p>
</div>

${verifyPanel}

<div class="panel">
  <h3>Provenance</h3>
  <p class="facts">snapshots ${esc(summary.snapshots)} &middot; grid ${GN.length}&times;${GX.length}&times;${DN.length} = ${summary.points} points &middot;
  ${summary.positiveAtEveryRho} positive at every &rho;, ${summary.negativeAtEveryRho} negative at every
  &rho;, ${summary.flipsInRange} flipping inside the range &middot; full tables in acl_grid.csv and acl_surface.csv &middot;
  rebuilt by: node src/acl_leverage_sweep.js --snapshots ${esc(summary.snapshots)}</p>
</div>`;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ACL leverage &times; &rho; &mdash; ${esc(snap.config)}</title>
<style>${css()}</style></head><body><main>${body}</main>
<script>window.ACL = ${JSON.stringify(DATA)};<\/script>
<script>${clientJs()}<\/script>
</body></html>`;

  fs.writeFileSync(path.join(out, "acl_leverage.html"), html);
}

/* ------------------------------------- client JS ------------------------------------- */
// Written as one IIFE, in the same idiom as the other reports' embedded scripts: no build
// step, no dependencies, canvas drawn at device pixel ratio, redrawn on resize and on a
// theme change.
function clientJs() {
  return `
(function () {
  "use strict";
  var D = window.ACL;
  var RH = D.rhos, GN = D.gn, GX = D.gx, DN = D.dn, SH = D.shipped;

  /* ------------------------------- the model, live ------------------------------- */
  // change% = 100*(q0 + g_x*q1 + (g_n - g_x)*q2 - d_n*q3). See acl_leverage_sweep.js for
  // where these four coefficients come from; here they are simply the model. cb is the
  // no-AI arm's own capability, so a level is cb*(1 + change/100).
  function changeOf(cell, q, gn, gx, dn) {
    var k = cell.coef[q];
    return 100 * (k[0] + gx * k[1] + (gn - gx) * k[2] - dn * k[3]);
  }
  // Reused across the tens of thousands of evaluations a surface takes: a fresh array and
  // a fresh sort per call is what made an earlier version of this page stutter on a slider
  // drag. Insertion sort rather than Array#sort — n is the cell count, around 18, where
  // the comparator call overhead dominates a real sort.
  var BUF = new Array(D.cells.length);
  function medianBy(f) {
    var n = 0, i, j, x;
    for (i = 0; i < D.cells.length; i++) {
      var v = f(D.cells[i]);
      if (v === v) {                                  // NaN check without a call
        x = v; j = n - 1;
        while (j >= 0 && BUF[j] > x) { BUF[j + 1] = BUF[j]; j--; }
        BUF[j + 1] = x; n++;
      }
    }
    if (!n) return NaN;
    return n % 2 ? BUF[(n - 1) / 2] : (BUF[n / 2 - 1] + BUF[n / 2]) / 2;
  }
  function medianChange(q, gn, gx, dn) {
    return medianBy(function (c) { return changeOf(c, q, gn, gx, dn); });
  }
  // The two levels. The reference is the median no-AI arm; the AI level is that reference
  // moved by the median change.
  //
  // NOT two medians taken independently. The experiment is paired, so the measured quantity
  // is the per-cell change and its median is what the rest of the study reports; two
  // separate medians would have a ratio that is neither, and this page would then draw a
  // surface at one height and colour it by a different comparison. One measured quantity,
  // one reference level, levels derived from them — so the heights and the hues cannot
  // disagree.
  function medianCapNoAI(q) {
    return medianBy(function (c) { return c.cb[q]; });
  }
  function medianCapAI(q, gn, gx, dn) {
    return medianCapNoAI(q) * (1 + medianChange(q, gn, gx, dn) / 100);
  }
  function series(gn, gx, dn) {
    return RH.map(function (_, q) { return medianChange(q, gn, gx, dn); });
  }
  // Interpolated in log(rho), the same way rho_sensitivity.js does it. Used for the
  // tooltip's "flips at" line, not for anything the charts are built on.
  function crossover(s) {
    for (var q = 1; q < s.length; q++) {
      var a = s[q - 1], b = s[q];
      if (!isFinite(a) || !isFinite(b) || a === b) continue;
      if ((a < 0) === (b < 0)) continue;
      var f = -a / (b - a);
      return Math.exp(Math.log(RH[q - 1]) + f * (Math.log(RH[q]) - Math.log(RH[q - 1])));
    }
    return null;
  }

  /* ---------------------------------- colour ----------------------------------- */
  // Diverging, because the quantity has a real zero with opposite meanings either side:
  // blue for a capability gain, red for a loss, a neutral grey at zero. Two hues plus a
  // grey midpoint, never a rainbow, and never a hue at the middle — a coloured midpoint
  // would make "no difference" look like a value.
  var POS = ["#cde2fb","#9ec5f4","#6da7ec","#3987e5","#2a78d6","#1c5cab","#0d366b"];
  var NEG = ["#fbd9d9","#f4b0b0","#ef8a8a","#e34948","#c62f2f","#a32020","#6f1414"];
  var MID_LIGHT = "#f0efec", MID_DARK = "#383835";
  var GOOD = "#0ca30c", CRITICAL = "#d03b3b";          // reserved status pair, never themed
  function isDark() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t === "dark") return true;
    if (t === "light") return false;
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function mix(a, b, t) {
    function p(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }
    var x = p(a), y = p(b), o = "#";
    for (var i = 0; i < 3; i++) {
      var c = Math.round(x[i] + (y[i] - x[i]) * t).toString(16);
      o += c.length < 2 ? "0" + c : c;
    }
    return o;
  }
  // t in [-1,1]: the sign picks the arm, the magnitude the step within it.
  function diverge(t) {
    var mid = isDark() ? MID_DARK : MID_LIGHT;
    if (!isFinite(t)) return mid;
    var arm = t < 0 ? NEG : POS, a = Math.min(1, Math.abs(t));
    var stops = [mid].concat(arm);
    var x = a * (stops.length - 1), i = Math.floor(x);
    if (i >= stops.length - 1) return stops[stops.length - 1];
    return mix(stops[i], stops[i + 1], x - i);
  }
  function tok(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  // The control is w, and rho is derived from it. Inverting w(E) = rho^((E-theta)/(1-theta))
  // gives rho = w^((1-theta)/(E-theta)), so a w and the E it is quoted at pin rho exactly.
  //
  // WHICH E. The 99th percentile of the run's own no-AI arm, measured by the sweep — "one
  // person in the top 1% of the field". Not the ceiling: w(1) = rho, so a slider anchored
  // there would be rho wearing a multiplication sign, and it would describe an E = 1 this
  // population never reaches. rho stays visible beside it, because rho is what the rest of
  // the study and every CSV column is keyed to.
  function fmtRho(rho) { return rho >= 100 ? String(Math.round(rho)) : String(+rho.toFixed(1)); }
  function wAt(rho) { return Math.pow(rho, (D.anchorE - D.theta) / (1 - D.theta)); }
  function fmtW(rho) {
    var v = wAt(rho);
    return "\u00d7" + (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(0) : v.toFixed(1));
  }
  // What the slider says: the multiple, with the rho behind it. Both, always — one is the
  // quantity the reader is being asked to judge, the other is the key to every other page
  // and file in the study, and dropping either one strands somebody.
  function fmtScale(rho) { return fmtW(rho) + "  (\u03c1 " + fmtRho(rho) + ")"; }
  // Axis numbers with no decoration: "0", "0.2", "0.43". A floor axis seen at an angle is
  // crowded to begin with, and "0.00" spends four characters saying what "0" says in one.
  function fmtAx(v) { return String(+(+v).toFixed(2)); }
  // Capability spans orders of magnitude, so the level readout is written the way the rest
  // of the study writes it rather than as a wall of digits.
  function fmtCap(v) {
    if (!isFinite(v)) return "n/a";
    if (v === 0) return "0";
    var e = Math.floor(Math.log(Math.abs(v)) / Math.LN10);
    if (e >= 3 || e <= -2) return (v / Math.pow(10, e)).toFixed(2) + "e" + e;
    return v.toFixed(2);
  }

  /* ------------------------------ canvas plumbing ------------------------------ */
  var FIGS = {};
  function sizeCanvas(cv) {
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 700, h = parseFloat(cv.style.height) || 400;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }
  function drawAll() {
    Object.keys(FIGS).forEach(function (id) {
      var cv = document.getElementById("fig-" + id);
      if (cv) FIGS[id](cv);
    });
  }

  /* ------------------------- figure 1: the value, as a surface ------------------------- */
  var ST = {
    metric: "change", rhoIdx: RH.length - 1,
    gxIdx: Math.max(0, GX.indexOf(SH.g_x)),
    az: -0.62, el: 0.62, shipped: true, bracket: false,
  };
  var EG = 21;                                   // evaluation grid across g_n and d_n
  var gridCache = null, gridKey = "";
  // The evaluated surface: value[i][j] over g_n x d_n, plus whatever reference the current
  // metric compares it against. Cached because a rotation reprojects the same numbers and
  // there is no reason to recompute a median a quarter of a million times to spin a chart.
  function grid() {
    var gx = GX[ST.gxIdx];
    var key = ST.metric + "|" + ST.rhoIdx + "|" + ST.gxIdx + "|" + ST.bracket + "|" + EG;
    if (gridCache && gridKey === key) return gridCache;
    var gnv = [], dnv = [], i, j;
    for (i = 0; i < EG; i++) {
      gnv.push(GN[0] + (GN[GN.length - 1] - GN[0]) * i / (EG - 1));
      dnv.push(DN[0] + (DN[DN.length - 1] - DN[0]) * i / (EG - 1));
    }
    var val = [], lo = [], hi = [];
    for (i = 0; i < EG; i++) {
      val.push([]); lo.push([]); hi.push([]);
      for (j = 0; j < EG; j++) {
        val[i].push(value(ST.rhoIdx, gnv[i], gx, dnv[j]));
        if (ST.bracket) {
          lo[i].push(value(0, gnv[i], gx, dnv[j]));
          hi[i].push(value(RH.length - 1, gnv[i], gx, dnv[j]));
        }
      }
    }
    gridCache = { gn: gnv, dn: dnv, gx: gx, val: val, lo: lo, hi: hi,
      ref: ST.metric === "change" ? 0 : medianCapNoAI(ST.rhoIdx) };
    gridKey = key;
    return gridCache;
  }
  function value(q, gn, gx, dn) {
    return ST.metric === "change" ? medianChange(q, gn, gx, dn) : medianCapAI(q, gn, gx, dn);
  }

  FIGS.cube = function (cv) {
    var s = sizeCanvas(cv), ctx = s.ctx, W = s.w, H = s.h;
    var ink = tok("--ink", "#14181a"), muted = tok("--ink-muted", "#5c6360"),
        faint = tok("--ink-faint", "#8b918d"), rule = tok("--rule", "#d7dad6"),
        surface = tok("--surface-1", "#fcfcfb");
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = surface; ctx.fillRect(0, 0, W, H);
    var G = grid(), i, j;

    // The vertical scale. For a change, symmetric about zero so that equal gains and
    // losses are equal distances from the plane and the eye is not told a story the
    // numbers do not support. For a level, log10, because capability spans orders of
    // magnitude and a linear axis would flatten every arm into the same line.
    var lin = ST.metric === "change";
    var tr = lin ? function (v) { return v; } : function (v) { return Math.log(Math.max(v, 1e-12)) / Math.LN10; };
    var vals = [];
    for (i = 0; i < EG; i++) for (j = 0; j < EG; j++) {
      vals.push(G.val[i][j]);
      if (ST.bracket) { vals.push(G.lo[i][j]); vals.push(G.hi[i][j]); }
    }
    vals.push(G.ref);
    var zlo, zhi;
    if (lin) {
      var m = 0;
      for (i = 0; i < vals.length; i++) if (isFinite(vals[i])) m = Math.max(m, Math.abs(vals[i]));
      m = m || 1; zlo = -m; zhi = m;
    } else {
      zlo = Infinity; zhi = -Infinity;
      for (i = 0; i < vals.length; i++) {
        if (!isFinite(vals[i])) continue;
        zlo = Math.min(zlo, tr(vals[i])); zhi = Math.max(zhi, tr(vals[i]));
      }
      var pad = (zhi - zlo) * 0.08 || 0.1; zlo -= pad; zhi += pad;
    }
    var nz = function (v) {
      var t = (tr(v) - (lin ? zlo : zlo)) / ((lin ? zhi : zhi) - zlo);
      return Math.max(-0.05, Math.min(1.05, t));
    };

    var cx = W * 0.5, cy = H * 0.56, scale = Math.min(W, H * 1.5) * 0.42, zs = H * 0.46;
    var ca = Math.cos(ST.az), sa = Math.sin(ST.az), se = Math.sin(ST.el), ce = Math.cos(ST.el);
    function proj(u, v, z) {
      var X = (u - 0.5) * ca - (v - 0.5) * sa;
      var Y = (u - 0.5) * sa + (v - 0.5) * ca;
      return { x: cx + X * scale, y: cy + Y * scale * se - (z - 0.5) * zs, d: Y * ce };
    }
    var nu = function (g) { return (g - GN[0]) / (GN[GN.length - 1] - GN[0]); };
    var nv = function (d) { return (d - DN[0]) / (DN[DN.length - 1] - DN[0]); };

    /* the box: back edges only, so the surface is never crossed by furniture in front */
    var corners = [[0,0],[1,0],[1,1],[0,1]];
    ctx.lineWidth = 1; ctx.strokeStyle = rule;
    corners.forEach(function (c) {
      var a = proj(c[0], c[1], 0), b = proj(c[0], c[1], 1);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });
    [0, 1].forEach(function (z) {
      ctx.beginPath();
      corners.forEach(function (c, k) {
        var p = proj(c[0], c[1], z);
        if (k) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      });
      ctx.closePath(); ctx.stroke();
    });

    /* surface quads and reference-plane quads in ONE depth-sorted list, so the plane
       passes correctly in front of the surface where it should and behind it where it
       should — two separate passes get this wrong wherever they interleave, which is
       exactly at the zero contour the chart exists to show. */
    var quads = [];
    for (i = 0; i < EG - 1; i++) for (j = 0; j < EG - 1; j++) {
      var ij = [[i,j],[i+1,j],[i+1,j+1],[i,j+1]];
      var ps = ij.map(function (c) { return proj(nu(G.gn[c[0]]), nv(G.dn[c[1]]), nz(G.val[c[0]][c[1]])); });
      var mean = (G.val[i][j] + G.val[i+1][j] + G.val[i+1][j+1] + G.val[i][j+1]) / 4;
      quads.push({ p: ps, d: (ps[0].d + ps[1].d + ps[2].d + ps[3].d) / 4, kind: "surf", v: mean });
      var rp = ij.map(function (c) { return proj(nu(G.gn[c[0]]), nv(G.dn[c[1]]), nz(G.ref)); });
      quads.push({ p: rp, d: (rp[0].d + rp[1].d + rp[2].d + rp[3].d) / 4, kind: "ref" });
      if (ST.bracket) {
        ["lo", "hi"].forEach(function (which) {
          var bp = ij.map(function (c) { return proj(nu(G.gn[c[0]]), nv(G.dn[c[1]]), nz(G[which][c[0]][c[1]])); });
          quads.push({ p: bp, d: (bp[0].d + bp[1].d + bp[2].d + bp[3].d) / 4, kind: which });
        });
      }
    }
    quads.sort(function (a, b) { return a.d - b.d; });
    // The colour scale is the DIFFERENCE from the reference in both metrics: in level
    // mode the height is capability but the hue still answers "more or less than without
    // AI", which is the comparison the figure is for.
    var span = lin ? (zhi || 1) : 1;
    quads.forEach(function (qd) {
      ctx.beginPath();
      qd.p.forEach(function (p, k) { if (k) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.closePath();
      if (qd.kind === "surf") {
        var t = lin ? qd.v / span : (qd.v - G.ref) / Math.max(1e-12, G.ref);
        ctx.fillStyle = diverge(t);
        ctx.globalAlpha = 1;
        ctx.fill();
        ctx.globalAlpha = 1; ctx.lineWidth = 0.6; ctx.strokeStyle = surface; ctx.stroke();
      } else if (qd.kind === "ref") {
        // The reference: grey, translucent and unlabelled per quad. It is a datum, not a
        // series, and it must not compete with the surface for attention.
        ctx.fillStyle = isDark() ? MID_DARK : MID_LIGHT;
        ctx.globalAlpha = 0.5; ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        // The rho brackets, as outlines only: a third and fourth filled surface would
        // hide the one being read.
        ctx.globalAlpha = 1; ctx.lineWidth = 0.7;
        ctx.strokeStyle = qd.kind === "lo" ? tok("--ink-faint", "#8b918d") : tok("--ink-muted", "#5c6360");
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;

    /* the pinned parameterisations */
    // Every published leverage triple, not only this config's own: the ACL family's
    // fifteen configs are five simulations read out at three parameter points, so the
    // other two belong on this chart as well.
    if (ST.shipped) {
      D.marks.forEach(function (mk, mi) {
        // A mark sits at its own g_x, which is usually not the slice on screen. Drawn
        // solid when the slider is on its g_x and hollow when it is not, rather than
        // silently plotting a point from a different slice as though it belonged here.
        var onSlice = Math.abs(mk.g_x - G.gx) < 1e-9;
        var v = value(ST.rhoIdx, mk.g_n, mk.g_x, mk.d_n);
        var ch = medianChange(ST.rhoIdx, mk.g_n, mk.g_x, mk.d_n);
        var base = proj(nu(mk.g_n), nv(mk.d_n), nz(G.ref)), top = proj(nu(mk.g_n), nv(mk.d_n), nz(v));
        ctx.setLineDash([3, 3]); ctx.strokeStyle = muted; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(top.x, top.y, mk.primary ? 5.5 : 4, 0, Math.PI * 2);
        // A 2px surface ring keeps the marker legible wherever it lands on the fill.
        if (onSlice) { ctx.fillStyle = ch > 0 ? GOOD : CRITICAL; ctx.fill(); }
        else { ctx.fillStyle = surface; ctx.fill(); ctx.strokeStyle = ch > 0 ? GOOD : CRITICAL; ctx.lineWidth = 2; ctx.stroke(); }
        ctx.lineWidth = 2; ctx.strokeStyle = surface; ctx.stroke();
        // Labels alternate above and below, because two of the three published triples
        // sit close together and their labels would otherwise overprint.
        var dy = mi % 2 ? 14 : -7;
        ctx.textAlign = "left";
        ctx.fillStyle = ink; ctx.font = (mk.primary ? "600 " : "") + "11px ui-monospace, monospace";
        ctx.fillText("(" + mk.g_n + ", " + mk.g_x + ", " + mk.d_n + ")" + (mk.primary ? "  this config" : "")
          + (onSlice ? "" : "  [Expert Gain " + mk.g_x + "]"), top.x + 9, top.y + dy);
        ctx.font = "10.5px ui-sans-serif, sans-serif"; ctx.fillStyle = muted;
        ctx.fillText((ch > 0 ? "+" : "") + ch.toFixed(1) + "% vs no-AI", top.x + 9, top.y + dy + 12);
      });
    }

    /* axes */
    // Anchored to the BOX FLOOR, not to the reference plane. The reference sits wherever
    // the data puts it — mid-height in level mode — and tick labels drawn there float in
    // the middle of the chart, over the surface, reading as annotations on the data rather
    // than as an axis. The floor is the one edge that stays an edge at every rotation.
    //
    // Which floor edge is the FRONT one changes as the chart turns, so the labelled edge
    // is chosen per draw: the one nearest the viewer, by the same depth the quads are
    // sorted on. Labels pinned to a fixed corner end up behind the surface half the time.
    var floorZ = 0;
    function edgeDepth(a, b) {
      return (proj(a[0], a[1], floorZ).d + proj(b[0], b[1], floorZ).d) / 2;
    }
    // g_n runs along v = 0 or v = 1; d_n along u = 0 or u = 1. Take whichever of each pair
    // is in front.
    var gnEdge = edgeDepth([0, 0], [1, 0]) >= edgeDepth([0, 1], [1, 1]) ? 0 : 1;
    var dnEdge = edgeDepth([0, 0], [0, 1]) >= edgeDepth([1, 0], [1, 1]) ? 0 : 1;
    // Push labels outward, away from the box, along the direction from the box centre.
    function outward(p, amount) {
      var c = proj(0.5, 0.5, floorZ);
      var dx = p.x - c.x, dy = p.y - c.y, len = Math.hypot(dx, dy) || 1;
      return { x: p.x + dx / len * amount, y: p.y + dy / len * amount };
    }
    ctx.font = "11px ui-monospace, monospace"; ctx.fillStyle = faint; ctx.textAlign = "center";
    // Three ticks a side, not five: on a rotated floor the labels sit at an angle to each
    // other and five of them run together at the corners.
    [0, 0.5, 1].forEach(function (t) {
      var pg = proj(t, gnEdge, floorZ), og = outward(pg, 16);
      // A 4px tick as well as the number: on a rotated floor the association between a
      // label and its position is otherwise left to the reader to guess.
      ctx.strokeStyle = rule; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pg.x, pg.y); ctx.lineTo(outward(pg, 4).x, outward(pg, 4).y); ctx.stroke();
      ctx.fillText(fmtAx(GN[0] + (GN[GN.length - 1] - GN[0]) * t), og.x, og.y + 4);

      var pd = proj(dnEdge, t, floorZ), od = outward(pd, 16);
      ctx.beginPath(); ctx.moveTo(pd.x, pd.y); ctx.lineTo(outward(pd, 4).x, outward(pd, 4).y); ctx.stroke();
      ctx.fillText(fmtAx(DN[0] + (DN[DN.length - 1] - DN[0]) * t), od.x, od.y + 4);
    });
    // The vertical axis, labelled in the metric's own units, on the back-left upright.
    ctx.textAlign = "right";
    for (var t2 = 0; t2 <= 1.0001; t2 += 0.25) {
      var zv = lin ? zlo + (zhi - zlo) * t2 : Math.pow(10, zlo + (zhi - zlo) * t2);
      var p3 = proj(0, 0, t2);
      ctx.fillText(lin ? (zv > 0 ? "+" : "") + zv.toFixed(1) + "%" : fmtCap(zv), p3.x - 8, p3.y + 4);
    }
    // Axis titles, outside their own tick labels and on the same edge those ticks went to,
    // so a rotation never leaves a title on one side and its numbers on the other.
    ctx.font = "600 11.5px ui-sans-serif, sans-serif"; ctx.fillStyle = muted;
    var gnT = outward(proj(0.5, gnEdge, floorZ), 40), dnT = outward(proj(dnEdge, 0.5, floorZ), 40);
    var zMid = proj(0, 0, 0.5);
    ctx.textAlign = "center";
    // Named, not symbolled. The symbols are the paper's, not the reader's: a figure lifted
    // out of this page as a PNG lands somewhere with no notation table beside it, and
    // "Novice Deficit" survives that journey where "d_n" does not. Still short enough not
    // to crowd an edge that is at an angle and moving — the qualifiers (which frontier
    // side, measured on whom) stay in the caption.
    ctx.fillText("Novice Gain", gnT.x, gnT.y + 4);
    ctx.fillText("Novice Deficit", dnT.x, dnT.y + 4);
    ctx.textAlign = "right";
    ctx.fillText(lin ? "% vs no-AI" : "capability (log)", zMid.x - 34, zMid.y - 8);
    // The two parameters NOT on an axis, stated rather than left to the controls: a figure
    // copied out as a PNG loses its sliders and has to say what slice it is.
    ctx.textAlign = "left";
    ctx.font = "11px ui-monospace, monospace"; ctx.fillStyle = faint;
    ctx.fillText("Expert Gain " + G.gx + "   expert value " + fmtW(RH[ST.rhoIdx])
      + " (top 1%, rho " + fmtRho(RH[ST.rhoIdx]) + ")", 10, 16);
    if (!lin) ctx.fillText("no-AI " + fmtCap(G.ref), 10, 30);

    FIGS.cube.hit = { proj: proj, G: G, nu: nu, nv: nv, nz: nz };
  };

  /* --------------------------- figure 2: the small multiples --------------------------- */
  FIGS.panels = function (cv) {
    var s = sizeCanvas(cv), ctx = s.ctx, W = s.w, H = s.h;
    var muted = tok("--ink-muted", "#5c6360"), faint = tok("--ink-faint", "#8b918d"),
        rule = tok("--rule", "#d7dad6"), surface = tok("--surface-1", "#fcfcfb"),
        ink = tok("--ink", "#14181a");
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = surface; ctx.fillRect(0, 0, W, H);

    var q = ST.rhoIdx;
    // One scale across every panel: panels that each normalised themselves would make
    // g_x = 0 and g_x = 0.8 look alike, which is the opposite of what they are for.
    var big = 0;
    GX.forEach(function (gx) {
      GN.forEach(function (gn) {
        DN.forEach(function (dn) { big = Math.max(big, Math.abs(medianChange(q, gn, gx, dn))); });
      });
    });
    big = big || 1;

    var n = GX.length, cols = Math.min(n, Math.max(3, Math.floor(W / 150)));
    var rows = Math.ceil(n / cols);
    // Room on the left for d_n's numbers and its title, and below for g_n's.
    var padL = 56, padT = 22, padB = 40, gap = 16;
    var pw = (W - padL - 10 - gap * (cols - 1)) / cols;
    var ph = (H - padT - padB - gap * (rows - 1)) / rows;
    var hits = [];
    GX.forEach(function (gx, k) {
      var col = k % cols, row = Math.floor(k / cols);
      var x0 = padL + col * (pw + gap), y0 = padT + row * (ph + gap);
      var cw = pw / GN.length, chh = ph / DN.length;
      GN.forEach(function (gn, i) {
        DN.forEach(function (dn, j) {
          var v = medianChange(q, gn, gx, dn);
          var x = x0 + i * cw, y = y0 + ph - (j + 1) * chh;
          ctx.fillStyle = diverge(v / big);
          ctx.fillRect(x, y, cw, chh);
          // 2px surface gap between adjacent fills.
          ctx.strokeStyle = surface; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, cw - 1, chh - 1);
          hits.push({ x: x, y: y, w: cw, h: chh, gn: gn, gx: gx, dn: dn, v: v });
          // The zero contour, drawn as the edge between a positive cell and the negative
          // one above it: the boundary is the point of the figure and a colour ramp alone
          // puts it wherever the reader's eye happens to land.
          if (j > 0) {
            var below = medianChange(q, gn, gx, DN[j - 1]);
            if ((below > 0) !== (v > 0)) {
              ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
              ctx.beginPath(); ctx.moveTo(x, y + chh); ctx.lineTo(x + cw, y + chh); ctx.stroke();
            }
          }
          for (var mi = 0; mi < D.marks.length; mi++) {
            var mk = D.marks[mi];
            if (gn === mk.g_n && gx === mk.g_x && dn === mk.d_n) {
              ctx.strokeStyle = ink; ctx.lineWidth = mk.primary ? 2.5 : 1.25;
              ctx.strokeRect(x + 1, y + 1, cw - 2, chh - 2);
            }
          }
        });
      });
      ctx.strokeStyle = rule; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, pw, ph);
      ctx.fillStyle = muted; ctx.font = "600 10.5px ui-monospace, monospace"; ctx.textAlign = "left";
      ctx.fillText("Expert Gain " + gx, x0, y0 - 6);
      // Numbers on both axes, not only names. Ends and middle rather than every grid value:
      // a panel this size cannot fit eleven labels a side without them colliding, and three
      // that can be read beat eleven that cannot. Drawn on the outer panels only — the
      // scales are identical across the grid, so repeating them on every panel is noise.
      ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = faint;
      var ends = [0, Math.floor((DN.length - 1) / 2), DN.length - 1];
      if (col === 0) {
        ctx.textAlign = "right";
        ends.forEach(function (ei) {
          // Cell centres, because a cell IS the value — a label on the cell boundary would
          // point between two of them.
          var cy2 = y0 + ph - (ei + 0.5) * chh;
          ctx.fillText(fmtAx(DN[ei]), padL - 10, cy2 + 3.5);
          ctx.strokeStyle = rule; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x0 - 4, cy2); ctx.lineTo(x0, cy2); ctx.stroke();
        });
        ctx.save(); ctx.translate(padL - 36, y0 + ph / 2); ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center"; ctx.fillStyle = muted; ctx.font = "600 10.5px ui-sans-serif, sans-serif";
        ctx.fillText("Novice Deficit", 0, 0); ctx.restore();
      }
      if (row === rows - 1) {
        ctx.textAlign = "center"; ctx.fillStyle = faint; ctx.font = "10px ui-monospace, monospace";
        [0, Math.floor((GN.length - 1) / 2), GN.length - 1].forEach(function (ei) {
          var cx2 = x0 + (ei + 0.5) * cw;
          ctx.fillText(fmtAx(GN[ei]), cx2, y0 + ph + 14);
          ctx.strokeStyle = rule; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(cx2, y0 + ph); ctx.lineTo(cx2, y0 + ph + 4); ctx.stroke();
        });
        ctx.fillStyle = muted; ctx.font = "600 10.5px ui-sans-serif, sans-serif";
        ctx.fillText("Novice Gain", x0 + pw / 2, y0 + ph + 30);
      }
    });
    FIGS.panels.hits = hits;
    FIGS.panels.scale = big;
  };

  /* ---------------------------------- legends ---------------------------------- */
  function rampCss() {
    var stops = [];
    for (var i = -8; i <= 8; i++) stops.push(diverge(i / 8));
    return "linear-gradient(90deg," + stops.join(",") + ")";
  }
  // The pins carry a status colour, which is never allowed to mean anything on its own:
  // this is the words half of that pairing.
  function markLegend() {
    return '<span class="it"><span class="sw" style="background:' + GOOD + '"></span>'
      + 'pinned values above no-AI</span>'
      + '<span class="it"><span class="sw" style="background:' + CRITICAL + '"></span>'
      + 'below it</span>';
  }
  function paintLegends() {
    var mid = isDark() ? MID_DARK : MID_LIGHT;
    var cube = document.getElementById("cube-legend");
    cube.innerHTML =
      '<span class="it"><span class="ramp" style="background:' + rampCss() + '"></span>'
      + 'loss &larr; 0 &rarr; gain, vs no-AI</span>'
      + '<span class="it"><span class="sw" style="background:' + mid + ';opacity:.6"></span>'
      + (ST.metric === "change" ? 'zero' : 'the no-AI arm') + '</span>'
      + (ST.bracket ? '<span class="it">outlines: ' + fmtW(D.rhoRange[0])
        + ' and ' + fmtW(D.rhoRange[1]) + '</span>' : '')
      + markLegend();
    document.getElementById("panel-legend").innerHTML =
      '<span class="it"><span class="ramp" style="background:' + rampCss() + '"></span>'
      + 'change vs no-AI, &plusmn;' + (FIGS.panels.scale || 0).toFixed(1) + '%</span>'
      + '<span class="it">heavier line: the zero contour</span>'
      + '<span class="it">expert value <b>' + fmtScale(RH[ST.rhoIdx]) + '</b></span>';
  }

  /* ----------------------------------- the table ----------------------------------- */
  function paintTable() {
    var gx = +document.getElementById("tbl-gx").value;
    var q = +document.getElementById("tbl-rho").value;
    var levels = document.getElementById("tbl-levels").checked;
    var h = ['<table class="data-table"><thead><tr><th>g_n \\\\ d_n</th>'];
    DN.forEach(function (dn) { h.push('<th>' + dn + (dn === SH.d_n ? ' *' : '') + '</th>'); });
    h.push('</tr></thead><tbody>');
    if (levels) {
      h.push('<tr><td>no AI</td><td colspan="' + DN.length + '" style="text-align:left">'
        + fmtCap(medianCapNoAI(q)) + ' &mdash; the same at every g_n and d_n, because the '
        + 'reference arm has no AI for them to act on</td></tr>');
    }
    GN.forEach(function (gn) {
      var ref = (gn === SH.g_n && gx === SH.g_x);
      h.push('<tr class="' + (ref ? 'ref' : '') + '"><td>' + gn + (ref ? ' *' : '') + '</td>');
      DN.forEach(function (dn) {
        var ch = medianChange(q, gn, gx, dn);
        var txt = levels ? fmtCap(medianCapAI(q, gn, gx, dn)) : (isFinite(ch) ? ch.toFixed(2) : '&mdash;');
        h.push('<td class="' + (ch > 0 ? 'pos' : 'neg') + '">' + txt + '</td>');
      });
      h.push('</tr>');
    });
    h.push('</tbody></table>');
    document.getElementById("tbl-host").innerHTML = h.join("");
  }

  /* ----------------------------------- tooltips ----------------------------------- */
  function showTip(id, x, y, html) {
    var t = document.getElementById("tip-" + id);
    t.innerHTML = html; t.style.opacity = 1;
    var wrap = t.parentNode.getBoundingClientRect();
    var left = Math.min(x + 12, wrap.width - t.offsetWidth - 6);
    t.style.left = Math.max(4, left) + "px";
    t.style.top = Math.max(4, y - t.offsetHeight - 10) + "px";
  }
  function hideTip(id) { document.getElementById("tip-" + id).style.opacity = 0; }

  // Every tooltip says the same four things, whichever figure asked: both capability
  // levels, the difference between them, and where the sign turns over in rho.
  function readout(q, gn, gx, dn) {
    var ch = medianChange(q, gn, gx, dn);
    var cross = crossover(series(gn, gx, dn));
    return "Novice Gain <b>" + (+gn).toFixed(3) + "</b> &middot; Expert Gain <b>" + gx
      + "</b> &middot; Novice Deficit <b>" + (+dn).toFixed(3) + "</b><br>"
      + "with AI <b>" + fmtCap(medianCapAI(q, gn, gx, dn)) + "</b><br>"
      + "without <b>" + fmtCap(medianCapNoAI(q)) + "</b><br>"
      + "<b>" + (ch > 0 ? "+" : "") + ch.toFixed(2) + "%</b> at " + fmtW(RH[q])
      + " (&rho; " + fmtRho(RH[q]) + ")<br>"
      + (cross === null
        ? (ch > 0 ? "a gain across the whole range" : "a loss across the whole range")
        : "flips sign at " + fmtW(cross) + " (&rho; " + fmtRho(cross) + ")");
  }

  function wireCube() {
    var cv = document.getElementById("fig-cube");
    var drag = null;
    cv.addEventListener("pointerdown", function (e) {
      drag = { x: e.clientX, y: e.clientY, az: ST.az, el: ST.el };
      cv.classList.add("dragging"); cv.setPointerCapture(e.pointerId); hideTip("cube");
    });
    cv.addEventListener("pointermove", function (e) {
      if (drag) {
        ST.az = drag.az + (e.clientX - drag.x) * 0.008;
        // Elevation clamped away from edge-on and from directly overhead: at either the
        // surface collapses to a line or the box stops reading as a box.
        ST.el = Math.max(0.12, Math.min(1.35, drag.el + (e.clientY - drag.y) * 0.006));
        FIGS.cube(cv);
        return;
      }
      var hit = FIGS.cube.hit;
      if (!hit) return;
      var r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      // Nearest evaluated point in screen space: the projection is not analytically
      // invertible, and with a few hundred points a scan is imperceptible.
      var best = null, G = hit.G;
      for (var i = 0; i < G.gn.length; i++) for (var j = 0; j < G.dn.length; j++) {
        var p = hit.proj(hit.nu(G.gn[i]), hit.nv(G.dn[j]), hit.nz(G.val[i][j]));
        var d2 = (p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my);
        if (!best || d2 < best.d2) best = { d2: d2, i: i, j: j };
      }
      if (!best || best.d2 > 900) { hideTip("cube"); return; }
      showTip("cube", mx, my, readout(ST.rhoIdx, G.gn[best.i], G.gx, G.dn[best.j]));
    });
    window.addEventListener("pointerup", function () { drag = null; cv.classList.remove("dragging"); });
    cv.addEventListener("pointerleave", function () { hideTip("cube"); });
  }

  function wirePanels() {
    var cv = document.getElementById("fig-panels");
    cv.addEventListener("mousemove", function (e) {
      var hits = FIGS.panels.hits;
      if (!hits) return;
      var r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      for (var i = 0; i < hits.length; i++) {
        var h = hits[i];
        if (mx >= h.x && mx <= h.x + h.w && my >= h.y && my <= h.y + h.h) {
          showTip("panels", mx, my, readout(ST.rhoIdx, h.gn, h.gx, h.dn));
          return;
        }
      }
      hideTip("panels");
    });
    cv.addEventListener("mouseleave", function () { hideTip("panels"); });
  }

  /* ------------------------------------ PNG export ------------------------------------ */
  function wireExport() {
    Array.prototype.forEach.call(document.querySelectorAll(".copy-btn[data-fig]"), function (btn) {
      btn.addEventListener("click", function () {
        var cv = document.getElementById("fig-" + btn.getAttribute("data-fig"));
        var act = btn.getAttribute("data-act");
        function flag(ok) {
          btn.classList.add(ok ? "is-done" : "is-fail");
          setTimeout(function () { btn.classList.remove("is-done", "is-fail"); }, 1400);
        }
        if (act === "save") {
          var a = document.createElement("a");
          a.href = cv.toDataURL("image/png");
          a.download = D.config.replace(/\\.json$/, "") + "-" + btn.getAttribute("data-fig") + ".png";
          a.click(); flag(true); return;
        }
        if (!navigator.clipboard || !window.ClipboardItem) { flag(false); return; }
        cv.toBlob(function (blob) {
          navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
            .then(function () { flag(true); }, function () { flag(false); });
        });
      });
    });
  }

  /* -------------------------------------- wiring -------------------------------------- */
  function redrawCube() { FIGS.cube(document.getElementById("fig-cube")); paintLegends(); }
  function wire() {
    var gxSel = document.getElementById("tbl-gx");
    GX.forEach(function (g) {
      var o = document.createElement("option");
      o.value = g; o.textContent = g + (g === SH.g_x ? "  (published)" : "");
      if (g === SH.g_x) o.selected = true;
      gxSel.appendChild(o);
    });
    var rhoSel = document.getElementById("tbl-rho");
    RH.forEach(function (r, q) {
      var o = document.createElement("option");
      o.value = q; o.textContent = fmtScale(r);
      if (q === RH.length - 1) o.selected = true;
      rhoSel.appendChild(o);
    });
    gxSel.addEventListener("change", paintTable);
    rhoSel.addEventListener("change", paintTable);
    document.getElementById("tbl-levels").addEventListener("change", paintTable);

    Array.prototype.forEach.call(document.querySelectorAll('input[name=metric]'), function (rb) {
      rb.addEventListener("change", function () {
        ST.metric = rb.value; gridCache = null; redrawCube();
      });
    });
    var gsl = document.getElementById("gx-slider");
    gsl.addEventListener("input", function () {
      ST.gxIdx = +gsl.value;
      document.getElementById("gx-val").textContent = GX[ST.gxIdx];
      gridCache = null; redrawCube();
    });
    var sl = document.getElementById("rho-slider");
    sl.addEventListener("input", function () {
      ST.rhoIdx = +sl.value;
      document.getElementById("rho-val").textContent = fmtScale(RH[ST.rhoIdx]);
      gridCache = null;
      // Both figures follow rho: the panels are the flat reading of the same slice, and a
      // page where the two disagreed about which rho it was showing would be a trap.
      drawAll(); paintLegends();
    });
    document.getElementById("show-bracket").addEventListener("change", function (e) {
      ST.bracket = e.target.checked; gridCache = null; redrawCube();
    });
    document.getElementById("show-shipped").addEventListener("change", function (e) {
      ST.shipped = e.target.checked; redrawCube();
    });
    document.getElementById("reset-view").addEventListener("click", function () {
      ST.az = -0.62; ST.el = 0.62; redrawCube();
    });

    wireCube(); wirePanels(); wireExport();
    drawAll(); paintLegends(); paintTable();
  }

  // The model, exposed deliberately. Two reasons: src/test/test_acl_leverage.js checks the
  // page's arithmetic against acl_grid.csv through it rather than re-deriving the formula a
  // second time, and a reader with the console open can ask the page a question the
  // controls do not cover (a parameter off the grid, a rho outside the swept ladder's
  // spacing) without rebuilding anything.
  window.ACL_MODEL = {
    changeOf: changeOf, medianChange: medianChange, series: series, crossover: crossover,
    medianCapAI: medianCapAI, medianCapNoAI: medianCapNoAI, state: ST,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
  window.addEventListener("resize", drawAll);
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      paintLegends(); drawAll();
    });
  }
})();
`;
}

/* --------------------------------------- index --------------------------------------- */
// A contact sheet, not a table of contents. Five thumbnails of the SAME figure the
// per-config pages draw, one per experiment, each one a link into its own page.
//
// It replaced a line chart overlaying the five runs' capability change against rho. That
// chart was defensible and not worth its place: it answered a question — "how do the five
// compare at one parameter point" — that the reader has not got to yet on arriving, while
// pushing the actual figures behind a table of links they had to notice. A reader landing
// here wants to see what this is; five small versions of it say that in one glance, and
// the differences between the five are visible in the shapes themselves.
//
// LIVE, in the same sense as the per-config pages: the thumbnails carry each run's four
// coefficients per (cell, rho) and redraw on the shared controls, so moving a slider moves
// all five at once. That is the comparison the old line chart was for, kept, but read off
// the figures rather than a separate abstraction of them.
function writeIndex(ctx) {
  const { root, runs } = ctx;

  // What separates the configs, read from each one rather than hardcoded: the ACL family
  // happens to differ in aiDampeningAbove today, and a mapping typed in here would keep
  // printing that after the family was regenerated with something else.
  const SYMBOL = {
    aiDampeningAbove: "γ_above", aiDampeningBelow: "γ_below",
    aiLevelFraction: "λ", frontierBreadth: "b",
  };
  const varying = [];
  if (runs.length > 1) {
    const keys = new Set();
    runs.forEach((r) => Object.keys(r.distinguishing || {}).forEach((k) => keys.add(k)));
    keys.forEach((k) => {
      if (new Set(runs.map((r) => JSON.stringify((r.distinguishing || {})[k]))).size > 1) varying.push(k);
    });
  }

  const r0 = runs[0].rhoRange[0], r1 = runs[0].rhoRange[1];
  // Comparable only where the grids and rho ladders match. Two sweeps run with different
  // --rho are two different measurements, and thumbnails on a shared colour scale would be
  // inviting a wrong reading, so the sheet says so and drops to plain links instead.
  const same = runs.every((r) =>
    r.rhos.length === runs[0].rhos.length && r.rhos.every((v, i) => v === runs[0].rhos[i])
    && JSON.stringify(r.grid) === JSON.stringify(runs[0].grid));

  const DATA = {
    rhos: runs[0].rhos, rhoRange: [r0, r1], grid: runs[0].grid,
    shipped: runs[0].shipped, comparable: same, varying,
    runs: runs.map((r) => ({
      dir: r.dir, config: r.config, tick: r.tick, replicates: r.replicates,
      cells: r.cellCount, distinguishing: r.distinguishing || {},
      verification: r.verification && r.verification.state,
      cellCoef: r.cellCoef,
    })),
  };

  const label = (r) => varying.map((k) => (SYMBOL[k] || k) + " = " + r.distinguishing[k]).join(", ");

  // One <a> per run, each wrapping its own canvas. Anchors rather than click handlers: a
  // thumbnail that cannot be opened in a new tab, or whose destination does not appear in
  // the status bar, is a worse link for no gain.
  const sheet = runs.map((r, i) => `<a class="thumb" href="${esc(r.dir)}/acl_leverage.html">
  <canvas id="thumb-${i}" height="150"></canvas>
  <span class="cap"><b>${esc(r.dir)}</b>${label(r) ? " &middot; " + esc(label(r)) : ""}</span>
  <span class="sub" id="thumb-sub-${i}"></span>
</a>`).join("\n");

  const rows = runs.map((r) => `<tr><td><a href="${esc(r.dir)}/acl_leverage.html">${esc(r.dir)}</a></td>`
    + `<td>${esc(label(r) || r.config)}</td><td>${r.cellCount}</td><td>${r.replicates}</td><td>${r.tick}</td>`
    + `<td>${r.verification === "pass" ? "passed" : r.verification === "fail" ? "FAILED" : "not run"}</td></tr>`).join("\n");

  const body = `
<div class="panel">
  <div class="head">
    <h1>Where AI is a net gain in capability</h1>
    <span class="sub">${runs.length} experiment${runs.length === 1 ? "" : "s"} &middot; &rho; ${r0}&ndash;${r1}</span>
  </div>
  <p>One panel per experiment: blue where the system ends up with more capability than it had without AI,
  red where it ends up with less. Open one for the full surface and the numbers.${varying.length
    ? ` The experiments differ in <b>${esc(varying.map((k) => SYMBOL[k] || k).join(", "))}</b> and nothing
  else.` : ""}</p>
</div>

<div class="panel">
  <div class="controls">
    <label>Novice Gain <input type="range" id="gn-slider" min="0" max="${runs[0].grid.g_n.length - 1}" value="0"> <b id="gn-val"></b></label>
    <label>Expert Gain <input type="range" id="gx-slider" min="0" max="${runs[0].grid.g_x.length - 1}" value="0"> <b id="gx-val"></b></label>
    <label>&rho; <input type="range" id="rho-slider" min="0" max="${runs[0].rhos.length - 1}" value="${runs[0].rhos.length - 1}"> <b id="rho-val"></b></label>
    <button class="copy-btn" id="reset-published" type="button">Published values</button>
  </div>
  ${same ? `<div class="sheet">${sheet}</div>
  <div class="legend" id="sheet-legend"></div>
  <p class="figcap">Each panel is Novice Gain across and Novice Deficit up, at the Expert Gain and &rho; set
  above &mdash; the same reading as the second figure on each experiment's own page, on one shared colour
  scale so the five can be compared directly. The line is where capability equals the no-AI arm. Novice Gain
  is a control here as well as an axis: it sets where the marker sits, which is the parameterisation each
  panel is annotated for.</p>`
    : `<p>These experiments were swept on different &rho; ladders or parameter grids, so they cannot share a
       colour scale. Open them individually below.</p>`}
</div>

<div class="panel">
  <div class="head"><h2>The runs</h2></div>
  <table class="data-table">
    <thead><tr><th>experiment</th><th>what differs</th><th>cells</th><th>replicates</th><th>tick</th><th>checked against the &rho; report</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="figcap">Verification compares each sweep against the published &rho; report at the published
  leverage values; it needs a matching replicate count to be exact.</p>
</div>`;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ACL leverage &times; &rho; &mdash; all experiments</title>
<style>${css()}${sheetCss()}</style></head><body><main>${body}</main>
<script>window.ACL_INDEX = ${JSON.stringify(DATA)};<\/script>
<script>${indexJs()}<\/script>
</body></html>`;
  fs.writeFileSync(path.join(root, "index.html"), html);
}

function sheetCss() {
  return `
.sheet{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.9rem}
.thumb{display:block;text-decoration:none;color:inherit;background:var(--panel-2);border:1px solid var(--rule);
border-radius:5px;padding:.6rem;transition:border-color .12s,transform .12s}
.thumb:hover{border-color:var(--accent2);transform:translateY(-1px)}
.thumb:focus-visible{outline:2px solid var(--accent2);outline-offset:2px}
.thumb canvas{width:100%;display:block;border-radius:3px}
.thumb .cap{display:block;margin-top:.5rem;font-size:.78rem;color:var(--ink);
font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.thumb .sub{display:block;margin-top:.15rem;font-size:.72rem;color:var(--ink-muted)}
@media(max-width:560px){.sheet{grid-template-columns:1fr 1fr}}
`;
}

/* ---------------------------------- index client JS ---------------------------------- */
function indexJs() {
  return `
(function () {
  "use strict";
  var D = window.ACL_INDEX;
  if (!D.comparable) return;
  var RH = D.rhos, G = D.grid, SH = D.shipped;
  var ST = {
    gn: Math.max(0, G.g_n.indexOf(SH.g_n)),
    gx: Math.max(0, G.g_x.indexOf(SH.g_x)),
    rho: RH.length - 1,
  };

  // The same identity the per-config pages use, over each run's own cells.
  function medianChange(run, q, gn, gx, dn) {
    var out = [], i;
    for (i = 0; i < run.cellCoef.length; i++) {
      var k = run.cellCoef[i][q];
      out.push(100 * (k[0] + gx * k[1] + (gn - gx) * k[2] - dn * k[3]));
    }
    out.sort(function (a, b) { return a - b; });
    var n = out.length;
    return n % 2 ? out[(n - 1) / 2] : (out[n / 2 - 1] + out[n / 2]) / 2;
  }

  // Diverging, same ramp as the per-config pages: a gain and a loss are opposite things
  // and the midpoint is grey, never a hue.
  var POS = ["#cde2fb","#9ec5f4","#6da7ec","#3987e5","#2a78d6","#1c5cab","#0d366b"];
  var NEG = ["#fbd9d9","#f4b0b0","#ef8a8a","#e34948","#c62f2f","#a32020","#6f1414"];
  var MID_LIGHT = "#f0efec", MID_DARK = "#383835";
  function isDark() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t === "dark") return true;
    if (t === "light") return false;
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function mix(a, b, t) {
    function p(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }
    var x = p(a), y = p(b), o = "#";
    for (var i = 0; i < 3; i++) {
      var c = Math.round(x[i] + (y[i] - x[i]) * t).toString(16);
      o += c.length < 2 ? "0" + c : c;
    }
    return o;
  }
  function diverge(t) {
    var mid = isDark() ? MID_DARK : MID_LIGHT;
    if (!isFinite(t)) return mid;
    var stops = [mid].concat(t < 0 ? NEG : POS);
    var x = Math.min(1, Math.abs(t)) * (stops.length - 1), i = Math.floor(x);
    if (i >= stops.length - 1) return stops[stops.length - 1];
    return mix(stops[i], stops[i + 1], x - i);
  }
  function tok(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function draw() {
    var gn = G.g_n[ST.gn], gx = G.g_x[ST.gx], q = ST.rho;
    // ONE scale across all five panels, computed over every panel's values. Panels that
    // each normalised themselves would make the mildest and the harshest experiment look
    // identical, which is the opposite of what a contact sheet is for.
    var big = 0;
    D.runs.forEach(function (run) {
      G.g_n.forEach(function (a) {
        G.d_n.forEach(function (b) { big = Math.max(big, Math.abs(medianChange(run, q, a, gx, b))); });
      });
    });
    big = big || 1;

    var ink = tok("--ink", "#14181a"), muted = tok("--ink-muted", "#5c6360"),
        surface = tok("--surface-1", "#fcfcfb"), rule = tok("--rule", "#d7dad6");

    D.runs.forEach(function (run, idx) {
      var cv = document.getElementById("thumb-" + idx);
      if (!cv) return;
      var dpr = window.devicePixelRatio || 1;
      var W = cv.clientWidth || 200, H = 150;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      var ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = surface; ctx.fillRect(0, 0, W, H);

      var L = 26, R = 6, T = 6, B = 20;
      var cw = (W - L - R) / G.g_n.length, ch = (H - T - B) / G.d_n.length;
      G.g_n.forEach(function (a, i) {
        G.d_n.forEach(function (b, j) {
          var v = medianChange(run, q, a, gx, b);
          var x = L + i * cw, y = T + (H - T - B) - (j + 1) * ch;
          ctx.fillStyle = diverge(v / big);
          ctx.fillRect(x, y, cw + 0.5, ch + 0.5);
          // The zero contour: the boundary is the point of the panel, and at thumbnail
          // size a colour ramp alone leaves the reader guessing where it falls.
          if (j > 0 && (medianChange(run, q, a, gx, G.d_n[j - 1]) > 0) !== (v > 0)) {
            ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(x, y + ch); ctx.lineTo(x + cw, y + ch); ctx.stroke();
          }
        });
      });
      ctx.strokeStyle = rule; ctx.lineWidth = 1;
      ctx.strokeRect(L, T, W - L - R, H - T - B);

      // Where the current Novice Gain sits, so the slider's effect is visible on the
      // panel and not only in the caption.
      var mx = L + (G.g_n.indexOf(gn) + 0.5) * cw;
      ctx.strokeStyle = ink; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx, T); ctx.lineTo(mx, H - B); ctx.stroke();
      ctx.globalAlpha = 1;

      // Axis ends only: at 210px there is room for the extremes and nothing else.
      ctx.fillStyle = muted; ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText(String(+G.d_n[G.d_n.length - 1]), L - 4, T + 8);
      ctx.fillText(String(+G.d_n[0]), L - 4, H - B - 1);
      ctx.textAlign = "center";
      ctx.fillText(String(+G.g_n[0]), L + cw / 2, H - B + 11);
      ctx.fillText(String(+G.g_n[G.g_n.length - 1]), W - R - cw / 2, H - B + 11);
      ctx.textAlign = "left";
      ctx.fillText("Novice Gain \\u2192", L, H - 2);
      ctx.save(); ctx.translate(9, T + (H - T - B) / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center"; ctx.fillText("Novice Deficit \\u2192", 0, 0); ctx.restore();

      // The panel's own headline, under it: what this experiment says at the parameters
      // currently set. A thumbnail nobody can read a number off is decoration.
      var here = medianChange(run, q, gn, gx, D.shipped.d_n);
      var sub = document.getElementById("thumb-sub-" + idx);
      if (sub) {
        sub.textContent = "at Novice Deficit " + D.shipped.d_n + ": "
          + (here > 0 ? "+" : "") + here.toFixed(1) + "% vs no-AI";
      }
    });

    var legend = document.getElementById("sheet-legend");
    if (legend) {
      var stops = [];
      for (var i = -8; i <= 8; i++) stops.push(diverge(i / 8));
      legend.innerHTML = '<span class="it"><span class="ramp" style="background:linear-gradient(90deg,'
        + stops.join(",") + ')"></span>loss &larr; 0 &rarr; gain vs no-AI, &plusmn;' + big.toFixed(1) + '%</span>'
        + '<span class="it">heavier line: capability equals the no-AI arm</span>'
        + '<span class="it">vertical rule: the Novice Gain set above</span>';
    }
  }

  function paintReadouts() {
    document.getElementById("gn-val").textContent = G.g_n[ST.gn];
    document.getElementById("gx-val").textContent = G.g_x[ST.gx];
    document.getElementById("rho-val").textContent = RH[ST.rho];
  }

  function wire() {
    [["gn-slider", "gn"], ["gx-slider", "gx"], ["rho-slider", "rho"]].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      el.value = ST[pair[1]];
      el.addEventListener("input", function () { ST[pair[1]] = +el.value; paintReadouts(); draw(); });
    });
    document.getElementById("reset-published").addEventListener("click", function () {
      ST.gn = Math.max(0, G.g_n.indexOf(SH.g_n));
      ST.gx = Math.max(0, G.g_x.indexOf(SH.g_x));
      ST.rho = RH.length - 1;
      document.getElementById("gn-slider").value = ST.gn;
      document.getElementById("gx-slider").value = ST.gx;
      document.getElementById("rho-slider").value = ST.rho;
      paintReadouts(); draw();
    });
    paintReadouts(); draw();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
  window.addEventListener("resize", draw);
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
  }
})();
`;
}

module.exports = { writePage, writeIndex };
