// Tests for the leverage x rho sweep: src/acl_snapshots.js, src/acl_leverage_sweep.js and
// the page src/acl_leverage_page.js writes.
//
//   node src/test/test_acl_leverage.js
//
// Three things are worth testing here, and they are different kinds of claim:
//
//   1. THE ALGEBRA. The sweep does not call engine.aclLeverage at all — it uses the
//      regrouped form l(E) = A + B*m(E) so that capability comes out linear in the three
//      parameters. If that regrouping is wrong, every number and every chart is wrong, and
//      nothing else in the repository would notice. Checked against engine.aclLeverage
//      directly, at random parameters, on a real population.
//   2. THE PIPELINE. A tiny config through snapshots -> sweep, asserting that the CSV, the
//      summary and a recomputation from the raw expertise all agree.
//   3. THE PAGE. Executed under a DOM stub, because no browser is available here: the
//      drawing code must not throw, the controls must not throw, and the page's own
//      arithmetic must reproduce acl_grid.csv. A chart that silently fails to draw looks
//      exactly like one that drew correctly, to everything except a reader.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const engine = require("../engine.js");
const paths = require("../paths.js");

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log("ok:", msg);
  else { console.error("FAIL:", msg); failures++; }
}
function close(a, b, tol, msg) {
  const rel = Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
  assert(rel <= tol, `${msg} (got ${a}, want ${b}, rel ${rel.toExponential(2)})`);
}

/* ------------------------- 1. the regrouping, against the engine ------------------------- */
// C = sum_i w(E_i) l(E_i) computed two ways: once through engine.aclLeverage person by
// person, and once through the four sums the sweep reduces a run to. They must agree to
// floating point, at any parameters, for any population — it is an identity, not an
// approximation, so a loose tolerance here would hide a real error.
{
  const s = engine.initSim({ seed: 7, N: 800, M: 20, aiEnabled: true, aiLevelFraction: 0.6 });
  for (let t = 0; t < 40; t++) engine.tick(s);
  const THETA = engine.EXPERT_THRESHOLD;
  const aiLevel = s.params.aiLevelFraction * s.startTopE;
  const rng = engine.mulberry32(99);
  let worst = 0;
  for (let trial = 0; trial < 40; trial++) {
    const p = Object.assign({}, s.params, {
      aclNoviceGain: rng() * 1.5,
      aclExpertGain: rng() * 1.5,
      aclNoviceDeficit: rng() * 1.5,
    });
    const rho = 1 + rng() * 3000;
    const k = Math.log(rho) / (1 - THETA);
    const F = Math.pow(aiLevel, p.frontierBreadth);

    let direct = 0, S0 = 0, S1 = 0;
    for (let i = 0; i < s.N; i++) {
      const w = Math.exp(k * (s.E[i] - THETA));
      direct += w * engine.aclLeverage(s.E[i], aiLevel, p);
      const m = 1 / (1 + Math.exp(p.aclBlendSharpness * (s.E[i] - aiLevel)));
      S0 += w;
      S1 += w * m;
    }
    // The sweep's form, exactly as acl_leverage_sweep.js assembles it.
    const viaCoef = S0 + p.aclExpertGain * F * S0
      + (p.aclNoviceGain - p.aclExpertGain) * F * S1
      - p.aclNoviceDeficit * (1 - F) * S1;
    worst = Math.max(worst, Math.abs(viaCoef - direct) / Math.abs(direct));
  }
  assert(worst < 1e-12, `l(E) = A + B*m(E) regrouping matches engine.aclLeverage over 40 random`
    + ` parameter draws (worst relative difference ${worst.toExponential(2)})`);
}

// w(theta) = 1 and w(1) = rho, the two anchors the whole capability unit rests on. Cheap,
// and it fails loudly if engine.js ever re-anchors the weight.
{
  const THETA = engine.EXPERT_THRESHOLD, rho = 250;
  const w = (E) => Math.exp(Math.log(rho) / (1 - THETA) * (E - THETA));
  close(w(THETA), 1, 1e-12, "w(theta) = 1");
  close(w(1), rho, 1e-12, "w(1) = rho");
}

// l(E) == 1 for every E when all three parameters are zero: AI that neither helps nor
// harms must leave capability untouched, whatever the frontier does. This is the reading
// the page's "zero everywhere" corner depends on.
{
  const p = Object.assign({}, engine.DEFAULT_PARAMS,
    { aclNoviceGain: 0, aclExpertGain: 0, aclNoviceDeficit: 0 });
  let worst = 0;
  for (let E = 0; E <= 1.0001; E += 0.05) {
    worst = Math.max(worst, Math.abs(engine.aclLeverage(E, 0.6, p) - 1));
  }
  assert(worst < 1e-12, "l(E) == 1 when g_n = g_x = d_n = 0, at every E");
}

/* ------------------------------ 2. the pipeline, end to end ------------------------------ */
// A deliberately tiny config: the point is that the two scripts agree with each other and
// with the raw expertise, which a 400-person 24-month run tests exactly as well as an
// 11,322-person 120-year one, in a second rather than ten minutes.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "acl-test-"));
const cfgPath = path.join(TMP, "test-config.json");
fs.writeFileSync(cfgPath, JSON.stringify({
  mode: "grid", replicates: 2, horizon: 24, recordAt: [12, 24], seed: 1,
  pairWithBaseline: true,
  fixed: { N: 400, M: 12 },
  params: {
    aiLevelFraction: { values: [0.4, 0.8] },
    aiDampeningBelow: { values: [0.8385, 0.7636] },
  },
}, null, 1));
const SNAP = path.join(TMP, "snap");
const node = process.execPath;
execFileSync(node, [paths.src("acl_snapshots.js"), "--config", cfgPath, "--out", SNAP, "--workers", "2"],
  { stdio: "pipe" });
execFileSync(node, [paths.src("acl_leverage_sweep.js"), "--snapshots", SNAP,
  "--rho", "60,800", "--rho-steps", "7", "--gn", "0:0.8:5", "--gx", "0:0.8:5", "--dn", "0:0.8:5"],
  { stdio: "pipe" });

const snap = JSON.parse(fs.readFileSync(path.join(SNAP, "snapshots.json"), "utf8"));
const summary = JSON.parse(fs.readFileSync(path.join(SNAP, "acl_summary.json"), "utf8"));
assert(snap.runs.length === 16, `snapshot holds every run (${snap.runs.length} of 16)`);
assert(fs.statSync(path.join(SNAP, "expertise.f32")).size === snap.values * 4,
  "expertise.f32 is exactly as long as snapshots.json says");
assert(snap.runs.every((r) => (r.arm === "baseline") === (r.aiLevel === null)),
  "every treatment run carries an aiLevel and every baseline run does not");
// Offsets must tile the file without gaps or overlaps, in run order — the sweep reads by
// offset, so a wrong one silently attributes one cell's population to another.
{
  let want = 0, ok = true;
  snap.runs.forEach((r) => { if (r.offset !== want) ok = false; want += r.n; });
  assert(ok && want === snap.values, "run offsets tile expertise.f32 exactly, in run order");
}

// The headline: recompute one grid point from the raw expertise, the long way — every
// person, engine.aclLeverage, no regrouping and no coefficients — and check the CSV.
{
  const bin = fs.readFileSync(path.join(SNAP, "expertise.f32"));
  const E = new Float32Array(bin.buffer, bin.byteOffset, snap.values);
  const rows = fs.readFileSync(path.join(SNAP, "acl_grid.csv"), "utf8").trim().split("\n").slice(1)
    .map((l) => l.split(","));
  const pick = rows[Math.floor(rows.length * 0.37)];
  const [gn, gx, dn, rho, want] = [+pick[0], +pick[1], +pick[2], +pick[3], +pick[4]];
  const p = Object.assign({}, engine.DEFAULT_PARAMS, {
    frontierBreadth: snap.frontierBreadth, aclBlendSharpness: snap.aclBlendSharpness,
    aclNoviceGain: gn, aclExpertGain: gx, aclNoviceDeficit: dn,
  });
  const k = Math.log(rho) / (1 - snap.theta);
  const capOf = (rec) => {
    let C = 0;
    for (let i = rec.offset; i < rec.offset + rec.n; i++) {
      const w = Math.exp(k * (E[i] - snap.theta));
      C += w * (rec.aiLevel === null ? 1 : engine.aclLeverage(E[i], rec.aiLevel, p));
    }
    return C;
  };
  const changes = [];
  for (let ci = 0; ci < snap.cells; ci++) {
    const mean = (arm) => {
      const rs = snap.runs.filter((r) => r.comboIndex === ci && r.arm === arm);
      return rs.reduce((s2, r) => s2 + capOf(r), 0) / rs.length;
    };
    const Ct = mean("treatment"), Cb = mean("baseline");
    changes.push(100 * (Ct - Cb) / Cb);
  }
  changes.sort((a, b) => a - b);
  const n = changes.length;
  const med = n % 2 ? changes[(n - 1) / 2] : (changes[n / 2 - 1] + changes[n / 2]) / 2;
  // 1e-4 relative, because the CSV is written to four decimal places: this compares a
  // rounded number, not two full-precision ones.
  close(med, want, 1e-4, `acl_grid.csv row (g_n ${gn}, g_x ${gx}, d_n ${dn}, rho ${rho})`
    + " matches a person-by-person recomputation through engine.aclLeverage");
}

// acl_surface.csv must be the same measurement as acl_grid.csv, collapsed: the verdict of a
// point has to agree with the signs of its own rows.
{
  const grid = new Map();
  fs.readFileSync(path.join(SNAP, "acl_grid.csv"), "utf8").trim().split("\n").slice(1)
    .forEach((l) => {
      const f = l.split(",");
      const key = f[0] + "|" + f[1] + "|" + f[2];
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(+f[4]);
    });
  let bad = 0;
  fs.readFileSync(path.join(SNAP, "acl_surface.csv"), "utf8").trim().split("\n").slice(1)
    .forEach((l) => {
      const f = l.split(",");
      const s2 = grid.get(f[0] + "|" + f[1] + "|" + f[2]);
      const allPos = s2.every((v) => v > 0), allNeg = s2.every((v) => v < 0);
      const want = allPos ? "positive" : allNeg ? "negative" : "flips";
      if (f[3] !== want) bad++;
    });
  assert(bad === 0, `every verdict in acl_surface.csv agrees with the signs in acl_grid.csv (${bad} disagreements)`);
}
assert(summary.positiveAtEveryRho + summary.negativeAtEveryRho + summary.flipsInRange === summary.points,
  "the summary's three verdict counts account for every grid point");
assert(summary.verification.state === "skipped",
  "verification reports itself skipped when no reference report exists, rather than passing silently");

/* --------------------------------- 3. the page, executed --------------------------------- */
// A DOM stub in the idiom of src/test/dom_stub_test_report.js: no browser is available, and
// a figure that throws while drawing is indistinguishable from one that drew, to every
// check except this one.
{
  const pageHTML = fs.readFileSync(path.join(SNAP, "acl_leverage.html"), "utf8");
  const drawnText = [];
  const CTX = new Proxy({}, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === "measureText") {
        const px = parseFloat(t.font) || 11;
        return (str) => ({ width: String(str).length * px * 0.6 });
      }
      if (p === "fillText") return (str, x, y) => drawnText.push({ text: String(str), x, y });
      return function () {};
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  const registry = new Map();
  const downloads = [];
  class FakeElement {
    constructor(tag) {
      this.tagName = (tag || "div").toUpperCase();
      this._id = ""; this._value = ""; this._text = ""; this._html = "";
      this.style = {}; this.children = []; this._listeners = {}; this._attrs = {};
      this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      // Non-degenerate, so the tooltip's clamp arithmetic runs on real numbers and a NaN
      // introduced later shows up as a wrong style.left rather than vanishing.
      this.offsetWidth = 150; this.offsetHeight = 60;
      this.clientWidth = 900;
      this.disabled = false;
    }
    get id() { return this._id; } set id(v) { this._id = v; registry.set(v, this); }
    get value() { return this._value; } set value(v) { this._value = String(v); }
    get textContent() { return this._text; } set textContent(v) { this._text = String(v); }
    get innerHTML() { return this._html; } set innerHTML(v) { this._html = String(v); this.children = []; }
    get parentNode() { return this._parent || (this._parent = new FakeElement("div")); }
    addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }
    dispatch(t, e) { (this._listeners[t] || []).forEach((f) => f(Object.assign({ target: this }, e))); }
    appendChild(c) { this.children.push(c); return c; }
    click() { if (this.tagName === "A" && this.download) downloads.push(this.download); }
    remove() {}
    setAttribute(k, v) { this._attrs[k] = v; if (k === "id") this.id = v; }
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
    getBoundingClientRect() { return { width: 900, height: 430, left: 0, top: 0 }; }
    getContext() { return CTX; }
    setPointerCapture() {}
    toDataURL() { return "data:image/png;base64,stub"; }
    toBlob(cb) { cb({ type: "image/png", size: 1 }); }
  }
  // Every id the page declares, with its real tag, scanned out of the markup rather than
  // hand-listed — a hand-listed set goes stale silently, and getElementById returning null
  // makes whatever touched it no-op and "pass".
  {
    const re = /<(\w+)[^>]*\bid="([\w-]+)"[^>]*>/g;
    let m;
    while ((m = re.exec(pageHTML))) {
      const el = new FakeElement(m[1]);
      el._id = m[2];
      registry.set(m[2], el);
    }
  }
  const needed = ["fig-cube", "tip-cube", "fig-panels", "tip-panels", "rho-slider", "rho-val",
    "gx-slider", "gx-val", "show-bracket", "show-shipped", "reset-view", "cube-legend",
    "panel-legend", "tbl-gx", "tbl-rho", "tbl-levels", "tbl-host"];
  const missing = needed.filter((id) => !registry.has(id));
  assert(missing.length === 0, `the page declares every id its script reaches for${missing.length ? ": missing " + missing.join(", ") : ""}`);

  // The two selector queries the page makes. Returned from a small map rather than by
  // parsing CSS: these are the only two, and a stub that guesses at selectors would be a
  // second implementation of a query engine to get wrong.
  const radios = ["change", "level"].map((v) => {
    const el = new FakeElement("input"); el.value = v; el.checked = v === "change"; return el;
  });
  const exportBtns = ["cube", "panels"].flatMap((f) => ["copy", "save"].map((a) => {
    const el = new FakeElement("button");
    el.setAttribute("data-fig", f); el.setAttribute("data-act", a);
    return el;
  }));
  const SELECTORS = { "input[name=metric]": radios, ".copy-btn[data-fig]": exportBtns };
  const documentElement = new FakeElement("html");
  documentElement.getAttribute = () => null;         // no explicit theme: follow the OS
  const document = {
    documentElement, readyState: "complete",
    getElementById: (id) => registry.get(id) || null,
    createElement: (tag) => new FakeElement(tag),
    querySelectorAll: (sel) => {
      if (!(sel in SELECTORS)) throw new Error("the page queries a selector this stub does not know: " + sel);
      return SELECTORS[sel];
    },
    body: new FakeElement("body"),
  };
  const CSS_VARS = { "--ink": "#14181a", "--ink-muted": "#5c6360", "--ink-faint": "#8b918d",
    "--rule": "#d7dad6", "--surface-1": "#fcfcfb" };
  const probe = {};
  const sandbox = {
    document,
    window: {
      devicePixelRatio: 1,
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener() {},
    },
    // navigator without a clipboard: the file:// case, where Copy PNG must fall back
    // rather than throw. That is the branch a reader opening the file locally will hit.
    navigator: {},
    getComputedStyle: () => ({ getPropertyValue: (n) => CSS_VARS[n] || "#888888" }),
    console, Math, Array, Object, JSON, String, Number, isFinite, parseFloat, parseInt,
    Float64Array, Infinity, NaN, setTimeout: (fn) => { fn(); return 0; },
    probe, drawnText,
  };
  sandbox.window.ACL = null;                   // overwritten by the page's own data block
  vm.createContext(sandbox);
  const scripts = [...pageHTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert(scripts.length === 2, `the page carries its data block and its script (${scripts.length} found)`);

  // The driver: every control the page offers, exercised, then the page's own arithmetic
  // compared against the CSV the sweep wrote.
  const driver = `
  var M = window.ACL_MODEL;
  if (!M) throw new Error("the page did not expose its model");

  // Hover over both figures — the cube's tooltip path walks its whole evaluation grid and
  // the panels' hit-tests its cells, and both are reached only by a pointer event.
  document.getElementById("fig-cube").dispatch("pointermove", { clientX: 420, clientY: 200 });
  document.getElementById("fig-panels").dispatch("mousemove", { clientX: 120, clientY: 140 });

  // Rotate: press, move, release. A drag reprojects but recomputes nothing.
  var cube = document.getElementById("fig-cube");
  cube.dispatch("pointerdown", { clientX: 300, clientY: 200, pointerId: 1 });
  cube.dispatch("pointermove", { clientX: 360, clientY: 230, pointerId: 1 });
  probe.azAfterDrag = M.state.az;

  // Both sliders, the rho brackets, and the level metric — the branch that puts capability
  // itself on the vertical axis and draws the no-AI arm as the reference surface.
  var gsl = document.getElementById("gx-slider");
  gsl.value = 2; gsl.dispatch("input");
  probe.gxIdx = M.state.gxIdx;
  probe.gxLabel = document.getElementById("gx-val").textContent;
  var sl = document.getElementById("rho-slider");
  sl.value = 3; sl.dispatch("input");
  probe.rhoIdx = M.state.rhoIdx;
  probe.rhoLabel = document.getElementById("rho-val").textContent;
  document.getElementById("show-bracket").dispatch("change", { target: { checked: true } });
  probe.bracket = M.state.bracket;

  var levelRadio = document.querySelectorAll("input[name=metric]")[1];
  levelRadio.dispatch("change");
  probe.metric = M.state.metric;
  probe.levelAxisLabels = drawnText.filter(function (t) { return /^-?\\d.*e\\d/.test(t.text); }).length;

  // Counted before the marker checkbox goes off: the labels are drawn only while it is on.
  probe.markLines = drawnText.filter(function (t) { return t.text.charAt(0) === "("; }).length;
  document.getElementById("show-shipped").dispatch("change", { target: { checked: false } });
  document.getElementById("reset-view").dispatch("click");
  probe.azAfterReset = M.state.az;

  // The table, both ways round.
  var gxSel = document.getElementById("tbl-gx");
  probe.gxOptions = gxSel.children.length;
  var rhoOpts = document.getElementById("tbl-rho").children;
  probe.rhoOptions = rhoOpts.length ? rhoOpts[rhoOpts.length - 1].textContent : "";
  gxSel.value = window.ACL.shipped.g_x;
  document.getElementById("tbl-rho").value = window.ACL.rhos.length - 1;
  gxSel.dispatch("change");
  probe.tableHtml = document.getElementById("tbl-host").innerHTML;
  var lv = document.getElementById("tbl-levels");
  lv.checked = true; lv.dispatch("change");
  probe.tableLevels = document.getElementById("tbl-host").innerHTML;
  probe.legend = document.getElementById("cube-legend").innerHTML
    + document.getElementById("panel-legend").innerHTML;

  // The export buttons: one copy (no clipboard here, so the fallback), one download.
  document.querySelectorAll(".copy-btn[data-fig]").forEach(function (b) { b.dispatch("click"); });

  // The page's own arithmetic, at points the CSV also carries.
  probe.points = [];
  window.ACL.gn.forEach(function (gn, i) {
    window.ACL.gx.forEach(function (gx, j) {
      window.ACL.dn.forEach(function (dn, k) {
        if ((i + j + k) % 7) return;
        window.ACL.rhos.forEach(function (r, q) {
          if (q % 3) return;
          probe.points.push({ gn: gn, gx: gx, dn: dn, rho: r,
            v: M.medianChange(q, gn, gx, dn),
            ai: M.medianCapAI(q, gn, gx, dn), no: M.medianCapNoAI(q) });
        });
      });
    });
  });
  `;

  let threw = null;
  try {
    vm.runInContext(scripts.join("\n") + "\n" + driver, sandbox, { filename: "acl_leverage+driver.js" });
  } catch (e) { threw = e; }
  assert(!threw, "the page's script and every control run without throwing"
    + (threw ? "\n  " + (threw.stack || threw) : ""));

  if (!threw) {
    assert(drawnText.length > 20, `both figures drew their labels (${drawnText.length} strings)`);
    // Named in words, not symbols: a figure lifted out as a PNG has no notation table
    // beside it. The symbols stay in the prose, which is why this asserts the names.
    assert(drawnText.some((t) => /Novice Gain/.test(t.text))
      && drawnText.some((t) => /Expert Gain/.test(t.text))
      && drawnText.some((t) => /Novice Deficit/.test(t.text)),
      "all three parameters are named in words on the figures");

    // Names are not enough: an axis with a title and no numbers cannot be read off. Both
    // floor axes must carry their own end values as text, on both figures.
    {
      // The page writes axis numbers bare — "0", "0.8" — so the expectation is built the
      // same way rather than with a fixed decimal count.
      const ax = (v) => String(+(+v).toFixed(2));
      const lo = ax(summary.grid.g_n[0]);
      const hi = ax(summary.grid.g_n[summary.grid.g_n.length - 1]);
      const dlo = ax(summary.grid.d_n[0]);
      const dhi = ax(summary.grid.d_n[summary.grid.d_n.length - 1]);
      const has = (v) => drawnText.filter((t) => t.text === v).length;
      assert(has(lo) >= 2 && has(hi) >= 2,
        `g_n's end values are drawn on both figures (${lo} x${has(lo)}, ${hi} x${has(hi)})`);
      assert(has(dlo) >= 2 && has(dhi) >= 2,
        `d_n's end values are drawn on both figures (${dlo} x${has(dlo)}, ${dhi} x${has(dhi)})`);
      // The vertical axis: per cent in change mode, a capability magnitude in level mode.
      assert(drawnText.some((t) => /%$/.test(t.text)) && drawnText.some((t) => /e\d+$/.test(t.text)),
        "the vertical axis is labelled in each metric's own units");
      // Nothing pushed off the canvas by the outward offsets — a label at a negative x is
      // invisible on a real page and identical to a correct one under a no-op canvas.
      // Axis titles are kept short on purpose — the long forms crowd an edge that is at
      // an angle and moving, and the prose below the figure carries the full wording. A
      // regression here is someone helpfully expanding a label.
      const titles = drawnText.filter((t) => /^(Novice Gain$|Novice Deficit$|% vs|capability \()/.test(t.text));
      const longest = titles.reduce((m, t) => Math.max(m, t.text.length), 0);
      assert(titles.length >= 4 && longest <= 20,
        `axis titles stay short (${titles.length} found, longest ${longest} characters)`);

      const off = drawnText.filter((t) => t.x < -40 || t.x > 940 || t.y < -20 || t.y > 480);
      assert(off.length === 0,
        `every label lands inside the canvas (${off.length} outside${off.length ? ": " + off.slice(0, 3).map((t) => `"${t.text}" at ${Math.round(t.x)},${Math.round(t.y)}`).join("; ") : ""})`);
    }
    assert(probe.metric === "level" && probe.bracket,
      "the capability-level metric and the rho brackets both engage");
    assert(probe.gxIdx === 2 && probe.gxLabel === String(summary.grid.g_x[2]),
      `the g_x slider's readout follows it (showed ${probe.gxLabel})`);
    // The readout is rho, not a multiple. w(E) = rho^((E-theta)/(1-theta)) raises rho to a
    // fractional exponent for everyone below the ceiling, so rho equals a multiple at
    // E = 1 and nowhere else; a control that called it "x800" would be stating a fact
    // about one person as though it described the whole scale. This assertion exists to
    // stop that being reintroduced.
    {
      const r = summary.rhos[3];
      const want = r >= 100 ? String(Math.round(r)) : String(+r.toFixed(1));
      assert(probe.rhoIdx === 3 && probe.rhoLabel === want,
        `the rho slider reads out rho itself (showed ${probe.rhoLabel}, want ${want} for rho ${r})`);
    }
    assert(Math.abs(probe.azAfterDrag - (-0.62)) > 1e-6 && Math.abs(probe.azAfterReset - (-0.62)) < 1e-9,
      "a drag rotates the view and Reset view puts it back");
    assert(probe.gxOptions === summary.grid.g_x.length,
      `the table offers every g_x (${probe.gxOptions} of ${summary.grid.g_x.length})`);
    assert(/<table/.test(probe.tableHtml) && /class="ref"/.test(probe.tableHtml),
      "the table renders and highlights the published row");
    assert(/no AI/.test(probe.tableLevels) && probe.tableLevels !== probe.tableHtml,
      "the table switches to capability levels and names the no-AI arm");
    assert(/loss/.test(probe.legend) && /gain/.test(probe.legend) && /zero contour/.test(probe.legend),
      "the legend names both directions of the diverging scale and the contour, not colour alone");
    // The table's options are rho values, matching the rho reports beside this page and
    // the rho column in acl_grid.csv.
    assert(/^\d+(\.\d+)?$/.test(probe.rhoOptions),
      `the table's rho options are rho values (e.g. "${probe.rhoOptions}")`);
    assert(downloads.length === 2 && downloads.every((d) => /\.png$/.test(d)),
      `Download PNG names a file per figure (${downloads.join(", ")})`);

    // The three published ACL parameterisations must be exactly on the grid, not near it —
    // the whole reason acl.1's snapshot can answer for acl.6 and acl.11 is that their
    // parameter points are grid points here.
    const wantMarks = [[0.43, 0.17, 0.19], [0.15, 0.05, 0.4], [0, 0, 0]];
    const onGrid = wantMarks.every((t) => summary.grid.g_n.includes(t[0])
      && summary.grid.g_x.includes(t[1]) && summary.grid.d_n.includes(t[2]));
    assert(onGrid, "all three published leverage triples are exact grid points");
    assert(summary.marks.length === wantMarks.length
      && summary.marks.filter((m) => m.primary).length === 1,
      `the summary carries all three as marks, one of them primary (${summary.marks.length} marks)`);
    assert(probe.markLines >= wantMarks.length,
      `every pinned parameterisation is labelled on the surface (${probe.markLines} labels drawn)`);
    assert(downloads.length === 2 && downloads.every((d) => /\.png$/.test(d)),
      `Download PNG names a file per figure (${downloads.join(", ")})`);

    // The page against the sweep: same measurement, two implementations, sampled across
    // the grid. 1e-4 relative because the CSV is written to four decimals.
    const csv = new Map();
    fs.readFileSync(path.join(SNAP, "acl_grid.csv"), "utf8").trim().split("\n").slice(1)
      .forEach((l) => {
        const f = l.split(",");
        csv.set([+f[0], +f[1], +f[2], +f[3]].join("|"), { ch: +f[4], ai: +f[5], no: +f[6] });
      });
    // Tolerance is absolute as well as relative, and for a reason: a change of -0.0001%
    // written to four decimal places is a rounding of nearly 100% in relative terms, so a
    // purely relative bar would fail on points that sit almost exactly on the zero
    // contour — which is precisely where most of the grid's interesting points are. Half
    // a CSV unit (5e-5) plus room for the page's 8-significant-figure coefficients.
    let checked = 0, worst = 0, worstAt = null, missingKey = 0;
    probe.points.forEach((pt) => {
      const key = [pt.gn, pt.gx, pt.dn, pt.rho].join("|");
      if (!csv.has(key)) { missingKey++; return; }
      checked++;
      const want = csv.get(key);
      const slack = Math.max(1e-3, 1e-4 * Math.abs(want.ch));
      const over = Math.abs(pt.v - want.ch) / slack;
      if (over > worst) { worst = over; worstAt = `${key} -> page ${pt.v}, csv ${want.ch}`; }
      // The levels too, not just the ratio: the page draws capability itself in one of its
      // two metrics, and a level that disagreed with the CSV would be a chart of nothing.
      [["ai", pt.ai], ["no", pt.no]].forEach(([k, got]) => {
        const rel = Math.abs(got - want[k]) / Math.max(1e-12, Math.abs(want[k]));
        if (rel / 1e-5 > worst) { worst = rel / 1e-5; worstAt = `${key} ${k} -> page ${got}, csv ${want[k]}`; }
      });
    });
    assert(missingKey === 0 && checked > 20,
      `every sampled page value has a matching acl_grid.csv row (${checked} checked, ${missingKey} unmatched)`);
    assert(worst <= 1, `the page reproduces acl_grid.csv to within rounding`
      + ` (worst point uses ${(worst * 100).toFixed(0)}% of its tolerance${worst > 1 ? ": " + worstAt : ""})`);

    // The relationship the whole page rests on: the change is exactly the gap between the
    // two levels it draws. If these ever disagreed, the surface and its reference plane
    // would be telling the reader two different stories.
    let levelBad = 0;
    probe.points.forEach((pt) => {
      const implied = 100 * (pt.ai - pt.no) / pt.no;
      if (Math.abs(implied - pt.v) > Math.max(1e-6, 1e-8 * Math.abs(pt.v))) levelBad++;
    });
    assert(levelBad === 0,
      `the plotted change is exactly the gap between the two plotted capability levels (${levelBad} bad)`);
  }
}

/* ------------------------------------- housekeeping ------------------------------------- */
fs.rmSync(TMP, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nall checks passed");
}
