// Minimal DOM stub to execute the simulator's <script> body under Node and
// exercise its main control flows (no real rendering — canvas ops are no-ops).
// Driver code is concatenated onto the SAME script text as the app so it can
// see the app's top-level `const`/function declarations (vm.runInContext
// does not expose script-level const/let on the context object).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const paths = require("../paths.js");

const registry = new Map();

// Every canvas method is a no-op EXCEPT the ones whose return value the drawing code
// uses. measureText is one: chart legends space their entries by the width of the text
// before them, so a bare no-op returns undefined and the layout throws.
// Text the charts draw, with the alignment and x it was drawn at. Recorded because
// clipped axis labels are otherwise invisible to this harness: every canvas call is a
// no-op, so a label rendered at a negative x looks exactly like one that fits.
const drawnText = [];
const CTX_STUB = new Proxy({}, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (prop === "measureText") return (str) => ({ width: String(str).length * 6 });
    if (prop === "fillText") return (str, x, y) => {
      drawnText.push({ text: String(str), x, y, align: target.textAlign });
    };
    return function () {};
  },
  set(target, prop, value) { target[prop] = value; return true; },
});

class Listeners {
  constructor() { this.map = {}; }
  add(type, fn) { (this.map[type] = this.map[type] || []).push(fn); }
  fire(type, evt) { (this.map[type] || []).forEach((fn) => fn(evt)); }
}

class FakeElement {
  constructor(tag) {
    this.tagName = (tag || "div").toUpperCase();
    this._id = ""; this._value = ""; this._checked = false; this._text = ""; this._html = "";
    this._attrs = {}; this._fieldMap = {}; this.children = [];
    // A real CSSStyleDeclaration-ish object: the layout sets its column width through a
    // custom property, and a bare {} silently lacks setProperty.
    this.style = {
      _props: {},
      setProperty(k, v) { this._props[k] = v; },
      getPropertyValue(k) { return this._props[k] != null ? this._props[k] : ""; },
      removeProperty(k) { delete this._props[k]; },
    };
    this._listeners = new Listeners();
    // A real class set, not a set of no-ops: refreshLiveHint uses toggle() and a driver
    // needs to read back whether the warning state was actually applied.
    this._classes = new Set();
    this.classList = {
      add: (c) => this._classes.add(c),
      remove: (c) => this._classes.delete(c),
      toggle: (c, on) => { const want = on == null ? !this._classes.has(c) : !!on;
        if (want) this._classes.add(c); else this._classes.delete(c); return want; },
      contains: (c) => this._classes.has(c),
    };
    this._max = ""; this._min = "";
  }
  get id() { return this._id; }
  set id(v) { this._id = v; registry.set(v, this); }
  get value() { return this._value; }
  set value(v) { this._value = String(v); }
  get max() { return this._max; }
  set max(v) { this._max = String(v); }
  get min() { return this._min || ""; }
  set min(v) { this._min = String(v); }
  get checked() { return this._checked; }
  set checked(v) { this._checked = !!v; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get title() { return this._attrs.title || ""; }
  set title(v) { this._attrs.title = v; }
  set innerHTML(html) { this._html = html; registerIdsFromHTML(html); this._fieldMap = parseFieldBlocks(html); }
  get innerHTML() { return this._html; }
  click() { this.dispatch("click", { target: this }); }
  addEventListener(type, fn) { this._listeners.add(type, fn); }
  dispatch(type, evt) { this._listeners.fire(type, evt || { target: this }); }
  setAttribute(k, v) { this._attrs[k] = v; if (k === "id") this.id = v; }
  getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; }
  getBoundingClientRect() { return { width: 800, height: 300, left: 0, top: 0 }; }
  getContext() { return CTX_STUB; }
  appendChild(child) { this.children.push(child); return child; }
  querySelector(sel) {
    const m = sel.match(/^\.field\[data-key="([^"]+)"\]$/);
    if (m) return this._fieldMap[m[1]] || null;
    if (sel === "input") return this._input || null;
    if (sel === "output") return this._output || null;
    if (sel === ".live-hint") return this._liveHint || null;
    if (sel === ".why") return this._why || null;
    if (sel === ".note") return this._note || null;
    return null;
  }
}

// Sub-elements are created only when the field's markup actually contains them. A stub
// that fabricates every slot regardless makes "is this control wired up?" unanswerable:
// querySelector would hand back an element the real page would not have, so code that
// only runs when the element exists appears to run for every field.
function makeFieldStub(initialValue, initialText, has) {
  has = has || {};
  const root = new FakeElement("div");
  const input = new FakeElement("input"); input.value = initialValue;
  const output = new FakeElement("output"); output.textContent = initialText;
  const liveHint = has.liveHint ? new FakeElement("div") : null;
  const why = has.why ? new FakeElement("button") : null;
  const note = has.note ? new FakeElement("div") : null;
  root._input = input; root._output = output;
  root._liveHint = liveHint; root._why = why; root._note = note;
  root.querySelector = (sel) => (sel === "input" ? input : sel === "output" ? output
    : sel === ".live-hint" ? liveHint : sel === ".why" ? why : sel === ".note" ? note : null);
  return root;
}

function parseFieldBlocks(html) {
  const map = {};
  // Captures to the START OF THE NEXT FIELD rather than the first </div>: a field now
  // holds several sibling divs (the description, the note, the live reading), and
  // stopping at the first close tag hid all but the earliest from this parser.
  // Trailing [^>]* so extra attributes on the wrapper don't stop a field being found.
  const re = /<div class="field" data-key="([^"]+)"[^>]*>([\s\S]*?)(?=<div class="field" data-key="|$)/g;
  let m;
  while ((m = re.exec(html))) {
    const key = m[1], block = m[2];
    const outM = block.match(/<output>([^<]*)<\/output>/);
    const valM = block.match(/<input[^>]*value="([^"]*)"/);
    map[key] = makeFieldStub(valM ? valM[1] : "0", outM ? outM[1] : "", {
      why: /class="why"/.test(block),
      note: /class="note"/.test(block),
      liveHint: /class="live-hint"/.test(block),
    });
  }
  return map;
}

function registerIdsFromHTML(html) {
  const re = /<(\w+)([^>]*)\bid="([\w-]+)"([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, tag, pre, id, post] = m;
    const attrs = pre + " " + post;
    const el = new FakeElement(tag);
    el._id = id;
    const valM = attrs.match(/\bvalue="([^"]*)"/);
    if (valM) el._value = valM[1];
    if (/\bchecked\b/.test(attrs)) el._checked = true;
    // Capture simple inner text too, so a driver can assert on what a rendered
    // readout actually SAYS and not merely that the element exists. Without this
    // every id'd element came back with an empty textContent.
    const textM = html.match(new RegExp('id="' + id + '"[^>]*>([^<]*)<'));
    if (textM) el._text = textM[1];
    registry.set(id, el);
  }
}

// Read here rather than at the point of use: the element registry below is built FROM
// this markup, so it has to exist first.
const pageHTML = fs.readFileSync(process.argv[2], "utf8");

// Every id the page declares, with its real tag, scanned straight out of the markup.
// This replaces a hand-maintained list that was the source of truth for four separate
// silent passes: an element missing from it made getElementById return null, so the
// code that touches it either no-opped or was never reached, and the flow "passed".
registerIdsFromHTML(pageHTML);

// The same list, now demoted to an ASSERTION. These are the ids the drivers below reach
// for by name; if the page stops declaring one, fail here rather than 900 lines later
// with a null dereference.
const staticIds = [
  "statT", "statN", "statM", "aiChip", "btnStep", "btnPlay", "speedRange",
  "btnRebuild", "scrubRange", "scrubLabel", "btnLive", "sidebar", "networkCanvas",
  "distCanvas", "distCounters", "divCanvas", "spreadCanvas", "inspector",
  "diffusionFlows", "diffusionMixing", "mixCanvas", "capCanvas",
];
const missing = staticIds.filter((id) => !registry.has(id));
if (missing.length) throw new Error("the page no longer declares these ids: " + missing.join(", "));
registry.get("scrubRange")._value = "0";
registry.get("scrubRange")._max = "0";
registry.get("speedRange")._value = "6";

const documentElement = new FakeElement("html");
documentElement.getAttribute = () => null;

// A real body element: the resize code toggles a class on it to suppress text
// selection while dragging.
const body = new FakeElement("body");
const document = { documentElement, body, getElementById: (id) => registry.get(id) || null };

// window listeners are RECORDED, not discarded. A drag registers its mousemove/mouseup
// on window and removes them on release; with a no-op addEventListener the whole
// interaction is unreachable from a driver and would pass untested.
const windowListeners = new Listeners();
const window = {
  devicePixelRatio: 1,
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  addEventListener: (t, f) => windowListeners.add(t, f),
  removeEventListener: (t, f) => {
    const a = windowListeners.map[t];
    if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }
  },
  fire: (t, e) => windowListeners.fire(t, e),
  _rafQueue: [],
  requestAnimationFrame(fn) { window._rafQueue.push(fn); return window._rafQueue.length; },
};
class MutationObserver { constructor(cb) { this.cb = cb; } observe() {} }
function getComputedStyle() { return { getPropertyValue: () => "#336699" }; }

function pumpRAFSrc() {} // placeholder, real pump lives in driver code below (has access to window)

const html = pageHTML;
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
if (!scriptMatch) throw new Error("no <script> found");

const driver = `
function pumpRAF(times, dtMs) {
  let ts = 0;
  for (let i = 0; i < times; i++) {
    ts += dtMs;
    const queue = window._rafQueue;
    window._rafQueue = [];
    queue.forEach((fn) => fn(ts));
  }
}

console.log("OK: script loaded and initial rebuild(false) ran without throwing");
console.log("initial state: t =", app.sim.t, "N =", app.sim.N, "M =", app.sim.M);
if (Number.isNaN(app.sim.E[0])) throw new Error("NaN in initial E");

console.log("--- pumping animation frames (paused) ---");
pumpRAF(5, 16);
console.log("OK: idle frames ran without throwing, t still", app.sim.t);

console.log("--- clicking Play, pumping ~10s of frames ---");
document.getElementById("btnPlay").dispatch("click");
pumpRAF(60, 1000/6);
console.log("OK: after play, t =", app.sim.t, "history length =", app.sim.history.length);
if (app.sim.t <= 0) throw new Error("sim did not advance while playing");

console.log("--- pausing, stepping once ---");
document.getElementById("btnPlay").dispatch("click");
const tBefore = app.sim.t;
document.getElementById("btnStep").dispatch("click");
console.log("OK: step advanced t from", tBefore, "to", app.sim.t);
if (app.sim.t !== tBefore + 1) throw new Error("step did not advance exactly one tick");

console.log("--- entrant / retirement counters ---");
{
  const el = document.getElementById("distCounters");
  app.viewT = app.sim.t;
  drawHistogram();
  // Earlier flows in this driver have already run the sim, so the baseline is whatever
  // they left behind rather than zero.
  const started = Number((el.textContent.match(/entrants ([\\d,]+)/) || [0, "0"])[1].replace(/,/g, ""));

  for (let i = 0; i < 480; i++) doTick();          // 40 more years
  app.viewT = app.sim.t;
  drawHistogram();
  const now = el.textContent;
  const n = app.sim.history[app.sim.history.length - 1].turnoverTotal;
  if (!(n > started)) throw new Error("turnover did not advance over 40 years: " + started + " -> " + n);
  // One replacement is one retirement AND one entrant, so the two must agree exactly —
  // the population is conserved by construction.
  const nums = now.match(/entrants ([\\d,]+) . retirements ([\\d,]+)/);
  if (!nums) throw new Error("counter text is malformed: " + now);
  if (nums[1] !== nums[2]) throw new Error("entrants and retirements disagree: " + now);
  if (Number(nums[1].replace(/,/g, "")) !== n) throw new Error("counter does not match the engine's turnoverTotal");
  const expected = app.sim.N * app.sim.t * app.sim.params.turnoverRate;
  if (Math.abs(n - expected) > expected * 0.25) {
    throw new Error("turnover " + n + " is far from the " + expected.toFixed(0) + " implied by N x ticks x turnover_rate");
  }
  console.log("OK:", now);

  // Scrubbing back must show the count AS OF that tick, not the live one.
  app.following = false; app.viewT = 120;
  drawHistogram();
  const scrubbed = Number(el.textContent.match(/entrants ([\\d,]+)/)[1].replace(/,/g, ""));
  if (!(scrubbed >= 0 && scrubbed < n)) throw new Error("scrubbed counter should sit below the live total, got " + scrubbed);
  if (scrubbed !== app.sim.history[119].turnoverTotal) throw new Error("scrubbed counter does not match that tick's history entry");
  console.log("OK: scrubbed to year 10 —", el.textContent);
  app.following = true; app.viewT = app.sim.t;
}

console.log("--- toggling AI on, resuming play ---");
const aiCheckbox = document.getElementById("fieldAiEnabled");
aiCheckbox.checked = true;
aiCheckbox.dispatch("change", { target: aiCheckbox });
console.log("OK: aiEnabled =", app.sim.params.aiEnabled, "toggle events =", app.sim.aiToggleEvents.length);
const tBeforeAI = app.sim.t;
document.getElementById("btnPlay").dispatch("click"); // resume (was paused after the step above)
pumpRAF(30, 1000/6);
document.getElementById("btnPlay").dispatch("click"); // pause again
console.log("after AI on + running: t =", app.sim.t, "meanE =", app.sim.history[app.sim.history.length-1].meanE.toFixed(4));
if (app.sim.t <= tBeforeAI) throw new Error("sim did not advance after resuming play");
if ("gap" in app.sim.history[app.sim.history.length-1]) throw new Error("the illusion gap metric should be gone — the C channel was removed in 2026-08");

console.log("--- switching mobility mode ---");
const mobSel = document.getElementById("fieldMobilityMode");
mobSel.value = "edge_constrained";
mobSel.dispatch("change", { target: mobSel });
console.log("OK: mobilityMode =", app.sim.params.mobilityMode);
if (app.sim.params.mobilityMode !== "edge_constrained") throw new Error("mobility mode select did not apply");

// This list is hand-maintained, and an id missing from it does not fail — the panel's
// render function just finds nothing and returns, so the flow passes without ever
// running. That is exactly how the diffusion panel first "passed", so it is asserted
// on directly below rather than trusted to the no-throw sweep.
console.log("--- diffusion readouts report real movement ---");
{
  const flows = document.getElementById("diffusionFlows").innerHTML;
  const mixing = document.getElementById("diffusionMixing").innerHTML;
  for (const label of ["moves", "expertise carried", "upgrading arrivals", "retirements"])
    if (flows.indexOf(label) === -1) throw new Error("diffusion flows missing row: " + label);
  for (const label of ["still at origin", "if fully mixed", "time in place"])
    if (mixing.indexOf(label) === -1) throw new Error("diffusion mixing missing row: " + label);
  // A panel of en-dashes renders perfectly well and means the counters never arrived.
  // Parsed by string slicing, not a regex: this block is spliced into the driver as a
  // template literal, which eats the backslashes a character class needs.
  // No quotes and no backslashes in this literal: the block is spliced into the driver
  // as a template literal, which eats both. ">moves</span><b>" is unique anyway — no
  // other row label ends in "moves".
  const marker = ">moves</span><b>";
  const at = flows.indexOf(marker);
  const moved = at === -1 ? "" : flows.slice(at + marker.length, flows.indexOf("</b>", at));
  if (!moved || moved.indexOf("/yr") === -1) throw new Error("diffusion panel shows no move rate after " + app.sim.t + " ticks, got: " + JSON.stringify(moved));
  if (parseInt(moved, 10) <= 0) throw new Error("diffusion panel reports no moves at all: " + moved);
  const h = app.sim.history[app.sim.history.length - 1];
  for (const k of ["moves", "moveExpertiseFlux", "upgradingArrivals", "originRetention", "mixedBaseline", "meanMonthsInPlace"])
    if (!(k in h)) throw new Error("engine history entry is missing " + k);
  if (h.originRetention > 1 || h.originRetention < 0) throw new Error("originRetention out of range: " + h.originRetention);
  // Whether the statistic survives the founding cohort is an engine property and is
  // pinned over four centuries in test_engine.js; this page-level run is 47 years, too
  // short to show it. Checked here only that the panel is wired to a live number.
  if (!(h.meanMonthsInPlace > 0)) throw new Error("meanMonthsInPlace is not positive: " + h.meanMonthsInPlace);
  if (h.upgradingArrivals > h.moves) throw new Error("upgrading arrivals exceed moves");
  console.log("OK: diffusion panel reports " + moved + ", retention " +
    (h.originRetention * 100).toFixed(1) + "% vs fully-mixed " + (h.mixedBaseline * 100).toFixed(1) + "%");
}

console.log("--- network node click -> inspector ---");
app.selectedInst = 0;
renderInspector();
console.log("OK: renderInspector ran, inspector html length =", document.getElementById("inspector").innerHTML.length);
if (document.getElementById("inspector").innerHTML.indexOf("Institution 0") === -1) throw new Error("inspector did not render selected institution");

// --- axis labels must fit inside the chart, on every chart ---------------------
// The reported bug: y-axis numbers clipped off the left edge. Invisible here until now,
// because a no-op canvas draws a label at x = -2 as happily as at x = 40. Right-aligned
// text ends at x and extends LEFT by its width, so x - width is its left edge.
// --- the way back to the project ------------------------------------------------
// The published page is all most visitors see: no README, no method, no statement of
// what the model assumes. The link out is the only route to any of that, so it is
// asserted rather than left to survive a future edit of the header.
// --- the parameter panel resizes and collapses ---------------------------------
// Driven through real events. The charts size themselves from getBoundingClientRect at
// draw time, so a resize that does not trigger a redraw leaves every canvas rendering
// at its old width — which looks like a rendering bug, not a layout one.
console.log("--- parameter panel resize / collapse ---");
{
  const layout = document.getElementById("layout");
  const handle = document.getElementById("sidebarHandle");
  const toggle = document.getElementById("sidebarToggle");
  if (!layout || !handle || !toggle) throw new Error("the sidebar drag handle is missing from the page");
  const widthNow = () => parseFloat(layout.style.getPropertyValue("--sidebar-w"));

  const start = widthNow();
  if (!(start > 0)) throw new Error("sidebar has no starting width: " + start);

  // Drag right by 120px.
  handle.dispatch("mousedown", { clientX: 400, target: handle, preventDefault: () => {} });
  window.fire("mousemove", { clientX: 520 });
  window.fire("mouseup", {});
  const wider = widthNow();
  if (wider <= start) throw new Error("dragging right did not widen the panel: " + start + " -> " + wider);

  // Drag far left: past the minimum it should collapse rather than stick at a floor.
  handle.dispatch("mousedown", { clientX: 400, target: handle, preventDefault: () => {} });
  window.fire("mousemove", { clientX: 0 });
  window.fire("mouseup", {});
  if (widthNow() !== 0) throw new Error("dragging shut did not collapse the panel: " + widthNow());
  if (toggle.getAttribute("aria-expanded") !== "false") throw new Error("collapse did not update aria-expanded");

  // The toggle restores it, and to a usable width rather than to zero.
  toggle.dispatch("click", { target: toggle });
  if (widthNow() < 100) throw new Error("toggle reopened the panel to " + widthNow() + "px");
  if (toggle.getAttribute("aria-expanded") !== "true") throw new Error("reopen did not update aria-expanded");

  // Clamped at both ends, so a long drag cannot swallow the dashboard.
  handle.dispatch("mousedown", { clientX: 0, target: handle, preventDefault: () => {} });
  window.fire("mousemove", { clientX: 5000 });
  window.fire("mouseup", {});
  if (widthNow() > 560) throw new Error("panel exceeded its maximum width: " + widthNow());
  console.log("OK: drags, clamps at " + widthNow() + "px, collapses and reopens");
}

console.log("--- the page links back to its source ---");
// String slicing, not a regex: this block is spliced into the driver as a template
// literal, which strips the backslashes a character class needs.
{
  const marker = '<a class="repo-link" href="';
  const at = PAGE_HTML.indexOf(marker);
  if (at === -1) throw new Error("simulator.html has no link back to the project repository");
  const rest = PAGE_HTML.slice(at + marker.length);
  const href = rest.slice(0, rest.indexOf('"'));
  const attrs = rest.slice(0, rest.indexOf(">"));
  if (href.indexOf("https://github.com/") !== 0 || href.split("/").length !== 5) {
    throw new Error("repo link is not a GitHub project URL: " + href);
  }
  // There is no save here, so navigating away loses the run in progress; and a _blank
  // without noopener hands the opened tab a handle on this one.
  if (attrs.indexOf('target="_blank"') === -1) {
    throw new Error("repo link would navigate away and discard the run in progress");
  }
  if (attrs.indexOf("noopener") === -1) throw new Error("repo link opens a new tab without rel=noopener");
  console.log("OK: links to " + href + ", new tab, noopener");
}

console.log("--- axis labels fit their gutters ---");
{
  drawnText.length = 0;
  drawSpreadChart();
  drawMiniChart("divCanvas", "divergence", "#000", { zeroFloor: true });
  drawMixChart();
  drawCapabilityChart();
  app.selectedInst = 0; renderInspector();
  const labels = drawnText.filter((d) => d.align === "right");
  if (labels.length < 8) throw new Error("expected axis labels from five charts, recorded " + labels.length);
  const clipped = labels.filter((d) => d.x - d.text.length * 6 < 0);
  if (clipped.length) {
    throw new Error("axis labels clipped off the left edge: " +
      clipped.map((d) => JSON.stringify(d.text) + " ends at x=" + d.x).join(", "));
  }
  const widest = labels.reduce((a, d) => (d.text.length > a.text.length ? d : a), labels[0]);
  console.log("OK: " + labels.length + " axis labels fit; widest is " +
    JSON.stringify(widest.text) + " at x=" + widest.x);
}

// --- a flat series must not be drawn as if it were eventful ------------------
// The reported bug: at a high ai_level_fraction the capability line is pinned by the AI
// floor and varies by a fraction of a percent, but autoscaling plotted that wobble
// across the whole frame; one real change then rescaled the axis by ~340x, which reads
// as a collapse followed by an explosion. Checked on the axis maths directly, since the
// symptom is a shape and there is nothing to measure on a no-op canvas.
console.log("--- near-constant series get a minimum axis span ---");
{
  const flat = [4.579e6, 4.5681e6, 4.5679e6, 4.5683e6];
  let mn = Infinity, mx = -Infinity;
  flat.forEach((v) => { const t = Math.log10(v); if (t < mn) mn = t; if (t > mx) mx = t; });
  const rawSpan = mx - mn;
  const [pmn, pmx] = padAxisSpan(mn, mx, { log: true });
  if (rawSpan > 0.01) throw new Error("fixture is not flat enough to exercise the guard");
  if (pmx - pmn < Math.log10(2) - 1e-9)
    throw new Error("log axis span " + (pmx - pmn).toFixed(4) + " is below the one-doubling floor");
  // ...and a series that genuinely spans decades must be left alone.
  const wide = padAxisSpan(Math.log10(1e4), Math.log10(1e7), { log: true });
  if (Math.abs((wide[1] - wide[0]) - 3) > 1e-9)
    throw new Error("a 3-decade series was rescaled: " + (wide[1] - wide[0]));
  // A pinned bound stays pinned: the 0..1 expertise axis must not grow a negative floor.
  const pinned = padAxisSpan(0.61, 0.61, { fixedMin: 0, fixedMax: 1 });
  if (pinned[0] !== 0.61 || pinned[1] !== 0.61)
    throw new Error("padAxisSpan overrode bounds the caller pinned: " + pinned.join(", "));
  console.log("OK: flat series padded from " + rawSpan.toExponential(1) + " to " +
    (pmx - pmn).toFixed(3) + " decades; wide series and pinned bounds untouched");
}

// --- controls that only initSim reads must say so ----------------------------
// expertiseMean/Spread/Skew are read by initSim and by nothing in tick(). Presented as
// live sliders they are inert mid-run, which is exactly the "I changed it and nothing
// happened / then everything happened" confusion behind the bug report.
console.log("--- init-only sliders light up Rebuild ---");
{
  const initOnly = PARAM_FIELDS.filter((f) => f.initOnly).map((f) => f.key);
  ["expertiseMean", "expertiseSpread", "expertiseSkew"].forEach((k) => {
    if (initOnly.indexOf(k) === -1) throw new Error(k + " is read only by initSim but is not marked initOnly");
  });
  markRebuildPending(false);
  const root = document.getElementById("sidebar").querySelector('.field[data-key="expertiseMean"]');
  const inp = root.querySelector("input");
  inp.value = "0.31";
  inp.dispatch("input", { target: inp });
  if (!document.getElementById("btnRebuild").classList.contains("needs-rebuild"))
    throw new Error("moving an init-only slider did not mark Rebuild as pending");
  console.log("OK: " + initOnly.length + " init-only sliders marked; moving one lights up Rebuild");
}

console.log("--- institution history: all series, bounded by thinning ---");
{
  const h = app.sim.instHistory;
  // Named explicitly rather than read from INST_SERIES: this list is the contract the
  // inspector charts rely on, and deriving it from the thing under test would let a
  // renamed or dropped series pass. It also guards the collision this caught once
  // already — a series called "cap" silently overwrote the sample-cap field.
  ["Ebar", "teach", "pop", "experts", "capability", "capabilityHuman"].forEach((k) => {
    if (!h[k] || !h[k][0] || h[k][0].length !== h.maxSamples)
      throw new Error("instHistory series " + k + " missing or wrong width");
  });
  if (typeof h.maxSamples !== "number") throw new Error("instHistory.maxSamples is not a number — a series name has shadowed it");
  if (h.len < 2) throw new Error("instHistory recorded nothing after " + app.sim.t + " ticks");

  // Two invariants the recording must satisfy, checked at the newest sample: headcount
  // is conserved across institutions, and nobody is an expert who is not also a person.
  const last = h.len - 1;
  let tot = 0;
  for (let j = 0; j < app.sim.M; j++) {
    tot += h.pop[j][last];
    if (h.experts[j][last] > h.pop[j][last])
      throw new Error("institution " + j + " records more experts than people");
  }
  if (tot !== app.sim.N) throw new Error("recorded populations sum to " + tot + ", not N=" + app.sim.N);

  // Thinning, on a throwaway history so the live one is not corrupted. The cap is
  // 2,000 samples and a UI run will not reach it during this test, so it is driven
  // directly — otherwise the branch that keeps memory flat is never executed here.
  const M2 = 3, h2 = makeInstHistory(M2);
  const zE = new Float32Array(M2), zT = new Float32Array(M2);
  const zC = new Int32Array(M2), zX = new Int32Array(M2);
  zE[0] = 0.5;                                    // a marker in the oldest sample
  pushInstHistory(h2, M2, zE, zT, zC, zX, zC, zC);
  zE[0] = 0.1;
  let guard = 0;
  while (h2.stride === 1 && guard++ < h2.maxSamples * 2) pushInstHistory(h2, M2, zE, zT, zC, zX, zC, zC);
  if (h2.stride !== 2) throw new Error("history never thinned after " + guard + " pushes");
  if (h2.len > h2.maxSamples) throw new Error("history exceeded its cap: " + h2.len + " > " + h2.maxSamples);
  if (h2.len !== h2.maxSamples >> 1) throw new Error("thinning left " + h2.len + " samples, expected " + (h2.maxSamples >> 1));
  if (h2.Ebar[0][0] !== 0.5) throw new Error("thinning dropped the oldest sample instead of every second one");
  console.log("OK: 6 series recorded, populations sum to N; thinned at " + h2.maxSamples +
    " samples to " + h2.len + " at stride " + h2.stride + ", oldest sample kept");
}

console.log("--- scrubbing to an earlier tick ---");
const scrub = document.getElementById("scrubRange");
const midT = Math.max(0, Math.floor(app.sim.t/2));
scrub.value = String(midT);
scrub.dispatch("input", { target: scrub });
console.log("OK: scrub set following=", app.following, "viewT=", app.viewT);
if (app.following !== false || app.viewT !== midT) throw new Error("scrub did not update view state");
pumpRAF(3, 16);

console.log("--- jumping back to live ---");
document.getElementById("btnLive").dispatch("click");
console.log("OK: following=", app.following, "viewT=", app.viewT, "sim.t=", app.sim.t);
if (app.viewT !== app.sim.t) throw new Error("live jump did not sync viewT to sim.t");

console.log("--- rebuilding with new N/M via structural fields ---");
document.getElementById("fieldN").value = "300";
document.getElementById("fieldM").value = "25";
document.getElementById("fieldAttach").value = "3";
document.getElementById("fieldSeed").value = "77";
document.getElementById("btnRebuild").dispatch("click");
console.log("OK: rebuilt. N =", app.sim.N, "M =", app.sim.M, "t reset to", app.sim.t);
if (app.sim.N !== 300 || app.sim.M !== 25) throw new Error("rebuild did not apply structural params");
if (app.sim.params.aiEnabled !== true) {
  throw new Error("rebuild did not preserve live params (aiEnabled)");
}

console.log("--- adjusting the gamma_below slider ---");
const atrophyField = document.getElementById("sidebar").querySelector('.field[data-key="aiDampeningBelow"]');
if (!atrophyField) throw new Error("aiDampeningBelow field not found in sidebar");
const atrophyInput = atrophyField.querySelector("input");
atrophyInput.value = "1.4";
atrophyInput.dispatch("input", { target: atrophyInput });
console.log("OK: aiDampeningBelow =", app.sim.params.aiDampeningBelow);
if (Math.abs(app.sim.params.aiDampeningBelow - 1.4) > 1e-9) throw new Error("gamma_below slider did not update sim params");

console.log("--- adjusting aiDampeningBelow (has a trailing .hint div — regression check for field-block parsing) ---");
const dampField = document.getElementById("sidebar").querySelector('.field[data-key="aiDampeningBelow"]');
if (!dampField) throw new Error("aiDampeningBelow field not found in sidebar");
const dampInput = dampField.querySelector("input");
if (!dampInput) throw new Error("aiDampeningBelow field has no input (hint div broke field-block parsing?)");
dampInput.value = "0.77";
dampInput.dispatch("input", { target: dampInput });
console.log("OK: aiDampeningBelow =", app.sim.params.aiDampeningBelow);
if (Math.abs(app.sim.params.aiDampeningBelow - 0.77) > 1e-9) throw new Error("aiDampeningBelow slider did not update sim params (must stay raw 0..2 for the engine)");
const dampOutput = dampField.querySelector("output");
console.log("OK: displayed output =", dampOutput.textContent, "(raw 0.77 should display as -0.23)");
if (dampOutput.textContent !== "-0.23") throw new Error("aiDampeningBelow output did not show the -1..+1 shifted display value, got: " + dampOutput.textContent);

console.log("--- randomizing seed button ---");
document.getElementById("btnRandSeed").dispatch("click");
console.log("OK: seed field now", document.getElementById("fieldSeed").value);

console.log("--- small-scale edge case: N=20 M=4 ---");
document.getElementById("fieldN").value = "20";
document.getElementById("fieldM").value = "4";
document.getElementById("fieldAttach").value = "2";
document.getElementById("btnRebuild").dispatch("click");
pumpRAF(60, 16);
console.log("OK: tiny scale ran, t =", app.sim.t, "N =", app.sim.N, "M =", app.sim.M);

pumpRAF(20, 16);

console.log("\\n--- world model: controls present and wired ---");
["fieldUseWorldModel", "fileWorldModel", "fileMobilityCosts", "fieldWeightedSizing", "worldModelStatus"]
  .forEach((id) => { if (!document.getElementById(id)) throw new Error("missing world-model control: " + id); });
console.log("OK: all five world-model controls exist");
console.log("OK: loader detected =", worldModelState.available);

console.log("\\n--- world model: the switch is inert until both files load ---");
// It used to accept the click and silently spring back, which reads as a broken
// control. Now it renders DISABLED until there is something to switch to, and says
// what it is waiting for.
{
  const html = document.getElementById("sidebar").innerHTML;
  const switchTag = html.match(/<input[^>]*id="fieldUseWorldModel"[^>]*>/);
  if (!switchTag) throw new Error("world-model switch was never rendered");
  if (!/\\bdisabled\\b/.test(switchTag[0])) {
    throw new Error("switch must be disabled before the files load, not clickable-and-reverting: " + switchTag[0]);
  }
  if (!/load both files above first/.test(html)) {
    throw new Error("the switch does not say what it is waiting for");
  }
  // Belt and braces: even if something did flip it, no world model means no switch.
  if (readStructuralFields().graphSource !== "ba") throw new Error("graphSource should still be ba");
  console.log("OK: switch renders disabled, note reads 'load both files above first'");
}
var wmToggle = document.getElementById("fieldUseWorldModel");

console.log("\\n--- world model: loading both files ---");
document.getElementById("fileWorldModel").dispatch("change",
  { target: { files: [{ name: "world-model.json", _contents: WORLD_JSON_TEXT }] } });
document.getElementById("fileMobilityCosts").dispatch("change",
  { target: { files: [{ name: "mobility-costs.json", _contents: COSTS_JSON_TEXT }] } });
if (!worldModelState.loaded) throw new Error("world model did not build: " + worldModelState.error);
console.log("OK: built M =", worldModelState.loaded.M, "fingerprint =", worldModelState.loaded.fingerprint);
console.log("OK: toggle auto-enabled =", document.getElementById("fieldUseWorldModel").checked);
{
  // ...and the switch is now live rather than disabled, with the Rebuild button
  // flagged, because nothing has been applied to the running sim yet.
  const html = document.getElementById("sidebar").innerHTML;
  const switchTag = html.match(/<input[^>]*id="fieldUseWorldModel"[^>]*>/)[0];
  if (/\\bdisabled\\b/.test(switchTag)) throw new Error("switch is still disabled after both files loaded");
  const btn = document.getElementById("btnRebuild");
  if (!/Structural changes are waiting/.test(btn.title || "")) {
    throw new Error("Rebuild button does not signal that a structural change is pending, title = " + btn.title);
  }
  console.log("OK: switch is live and Rebuild is flagged as pending");
}

console.log("\\n--- world model: structural fields switch over ---");
var sf = readStructuralFields();
console.log("OK: graphSource =", sf.graphSource, "| M omitted (derived) =", !("M" in sf));
if (sf.graphSource !== "worldModel") throw new Error("graphSource should be worldModel");
if ("M" in sf) throw new Error("M must not be passed in world-model mode — it is derived");

console.log("\\n--- world model: rebuild onto the real graph ---");
document.getElementById("fieldWeightedSizing").checked = true;
document.getElementById("fieldN").value = "600";
document.getElementById("btnRebuild").dispatch("click");
console.log("OK: rebuilt N =", app.sim.N, "M =", app.sim.M, "(derived from data)");
if (app.sim.M !== worldModelState.loaded.M) throw new Error("M should equal the world model's M");
if (app.sim.params.institutionSizing !== "weighted") throw new Error("weighted sizing not applied");
for (var wt = 0; wt < 12; wt++) doTick();
var wmEntry = app.sim.history[app.sim.history.length - 1];
console.log("OK: ticked on the world graph, t =", app.sim.t, "meanE =", wmEntry.meanE.toFixed(3));
console.log("OK: occupancy diagnostics present, minOccupancy =", wmEntry.minOccupancy,
  "underOccupied =", wmEntry.underOccupiedInstitutions);
if (typeof wmEntry.minOccupancy !== "number") throw new Error("occupancy diagnostics missing");

console.log("\\n--- world model: nodes identify themselves ---");
{
  // On the world-model graph a node is a real organisation, so the inspector has to
  // name it rather than showing an index — that is the only way to tell which part of
  // the graph you are looking at.
  app.selectedInst = 0;
  renderInspector();
  const html = document.getElementById("inspector").innerHTML;
  const inst = app.sim.graph.institutions[0];
  if (!inst) throw new Error("world-model graph exposes no institution metadata");
  if (!html.includes(inst.label)) throw new Error("inspector does not show the institution's label: " + html.slice(0, 200));
  if (!inst.hubCities.length) throw new Error("institution has no hub city resolved from world-model.json");
  if (!html.includes(inst.hubCities[0])) throw new Error("inspector does not show the hub city");
  if (!html.includes("sector")) throw new Error("inspector does not show the sector");
  const tip = institutionTooltip(0);
  if (!tip.includes(inst.label) || !tip.includes(inst.hubCities[0])) throw new Error("hover tooltip does not name the institution: " + tip);
  console.log("OK: node 0 reads as", JSON.stringify(tip));

  // Every institution must resolve to a city, or the panel shows a dash for some nodes.
  const noCity = app.sim.graph.institutions.filter((x) => !x.hubCities.length).length;
  if (noCity) throw new Error(noCity + " institutions have no hub city");
  console.log("OK: all", app.sim.graph.institutions.length, "institutions resolve a city");
}

console.log("\\n--- world model: the 245-node layout stays finite and on-canvas ---");
{
  // Regression: the force layout used to diverge on this graph. Radius was a fixed
  // 120 units regardless of M, so 245 institutions started ~3 units apart with
  // repulsion going as 1/d^2; the Fruchterman-Reingold d^2 attraction then had no
  // step limit, and the world model's 12.2 mean degree (vs the BA graph's ~4) piles
  // several times more of it onto each node. Coordinates passed 1e6 within five
  // steps and every one was NaN by twenty.
  for (let i = 0; i < 400; i++) relaxLayout();
  let maxAbs = 0, nonFinite = 0;
  for (const p of app.layout) {
    if (!isFinite(p.x) || !isFinite(p.y)) { nonFinite++; continue; }
    maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y));
  }
  if (nonFinite) throw new Error(nonFinite + " of " + app.layout.length + " layout positions are not finite — the layout diverged");
  if (maxAbs > 5000) throw new Error("layout expanded to " + maxAbs.toFixed(0) + " units — it is running away");
  console.log("OK: layout settled, max|coord| =", maxAbs.toFixed(0), "over 400 relax steps, all finite");

  // And the renderer has to FIT that, not assume a fixed extent — an in-range layout
  // drawn off-canvas looks identical to one that flew apart.
  drawNetwork();
  const hit = document.getElementById("networkCanvas")._hit;
  let off = 0;
  for (const p of hit.layout) {
    const X = hit.px(p.x), Y = hit.py(p.y);
    if (!(X >= 0 && X <= 800 && Y >= 0 && Y <= 300)) off++;
  }
  if (off) throw new Error(off + " of " + hit.layout.length + " institutions render outside the canvas");
  console.log("OK: all", hit.layout.length, "institutions render inside the canvas");
}

console.log("\\n--- world model: toggling back to BA ---");
document.getElementById("fieldUseWorldModel").checked = false;
document.getElementById("fieldM").value = "30";
document.getElementById("btnRebuild").dispatch("click");
console.log("OK: back on BA, M =", app.sim.M, "graphSource =", app.sim.params.graphSource);
if (app.sim.params.graphSource !== "ba") throw new Error("should have reverted to ba");
if (app.sim.M !== 30) throw new Error("M field should apply again in BA mode");

// --- the three AI dials are independent (rho_AI removed 2026-08) --------------
console.log("\\n--- AI dials: all three always present, set directly ---");
{
  const ai = () => app.sim.params;
  const field = (k) => document.getElementById("sidebar").querySelector('.field[data-key="' + k + '"]');
  ["aiDampeningBelow", "aiDampeningAbove"].forEach((k) => {
    if (!field(k)) throw new Error("AI group is missing " + k + " — all three are settable now, none is derived");
  });
  if (field("aiRelianceIntensity")) throw new Error("rho slider is back; it was removed");
  if ("aiRelianceIntensity" in ai()) throw new Error("rho leaked into params");
  if (document.getElementById("fieldCoupleReliance")) throw new Error("couple_reliance toggle is back; it was removed");

  // Each moves only itself — no derivation, no cross-talk.
  const before = { b: ai().aiDampeningBelow, a: ai().aiDampeningAbove };
  const inp = field("aiDampeningBelow").querySelector("input");
  inp.value = "1.4";
  inp.dispatch("input");
  if (Math.abs(ai().aiDampeningBelow - 1.4) > 1e-9) throw new Error("gamma_below slider did not take");
  if (ai().aiDampeningAbove !== before.a) {
    throw new Error("moving gamma_below moved another dial — nothing should be coupled now");
  }
  console.log("OK: gamma_below =", ai().aiDampeningBelow, "| gamma_above untouched");

  // Fully blocked learning is expressible and still runs — with mu_atr gone this is
  // the model's harshest AI setting, not one half of it.
  const gB = field("aiDampeningBelow").querySelector("input");
  gB.value = "0"; gB.dispatch("input");
  const tPre = app.sim.t;
  for (let i = 0; i < 5; i++) document.getElementById("btnStep").dispatch("click");
  if (app.sim.t !== tPre + 5) throw new Error("stepping with learning blocked did not advance 5 ticks");
  console.log("OK: learning fully blocked runs, t =", app.sim.t);

  // A Rebuild carries the live dials through untouched.
  document.getElementById("btnRebuild").dispatch("click");
  if (app.sim.params.aiDampeningBelow !== 0) {
    throw new Error("rebuild did not preserve the AI dials: " + app.sim.params.aiDampeningBelow);
  }
  console.log("OK: rebuild preserved them");
}

console.log("\\n--- stale configs are rejected, not silently ignored ---");
{
  let threw = false;
  try { ENGINE.initSim({ N: 40, M: 6, seed: 1, aiRelianceIntensity: 0.5 }); }
  catch (e) { threw = /aiRelianceIntensity was removed/.test(e.message); }
  if (!threw) throw new Error("engine accepted aiRelianceIntensity — it would land in params and every CSV column");
  console.log("OK: initSim throws on the removed key");
}

// The page must be running the REAL engine, not a copy of it. Identity checks, not
// value comparisons: === on the exported objects can only pass if simulator.html
// pulled them off the injected module. Value equality was the old test, back when
// the page carried its own copy of the model — it could pass while the two files
// drifted in any function it did not happen to compare.
console.log("\\n--- steady-state preset ---");
{
  // Put the model somewhere clearly NOT steady first, so the button has work to do.
  app.sim.params.decayRate = 0.005;
  app.sim.params.transferRate = 0.28;
  app.sim.params.personalLearningRate = 0;
  app.sim.params.aiEnabled = true;
  app.sim.params.learningCap = 0.0056;      // pipeline stays on; the preset must respect it

  const btn = document.getElementById("btnSteadyState");
  if (!btn) throw new Error("the steady-state button was never rendered");
  btn.dispatch("click");

  const p = app.sim.params;
  // Which decay rate is right depends on whether the entrant pipeline is on: a
  // multi-year climb moves where decay balances, so the no-pipeline rule does not
  // apply to it.
  const expected = p.learningCap > 0 ? ENGINE.PIPELINE_PARAMS.decayRate : steadyStateDecayRate(app.sim.N, app.sim.M);
  if (p.transferRate !== 0.15) throw new Error("preset did not set transfer_rate, got " + p.transferRate);
  if (p.decayRate !== expected) throw new Error("preset decay_rate " + p.decayRate + " != expected " + expected);
  if (Math.abs(p.turnoverRate - 1 / 480) > 1e-12) throw new Error("preset did not set a 40-year career");
  if (p.personalLearningRate !== PIPELINE_PARAMS.personalLearningRate) throw new Error("preset must restore personal learning to the calibrated value, got " + p.personalLearningRate);
  if (p.aiEnabled !== false) throw new Error("a steady state is the no-AI baseline; the preset must switch AI off");
  if (app.sim.t !== 0) throw new Error("preset must rebuild — the starting population is drawn once, at init");
  console.log("OK: preset applied beta =", p.transferRate, "delta =", p.decayRate, "r = 1/480, ambient on, AI off, t reset to", app.sim.t);

  // The rule has to scale with institution size, not be a constant in disguise.
  const small = steadyStateDecayRate(500, 100);   // 5 per institution
  const big = steadyStateDecayRate(4000, 40);     // 100 per institution
  if (!(small > big)) throw new Error("decay should FALL as institutions get bigger, got " + small + " vs " + big);
  console.log("OK: rule scales —", small, "at 5 people per institution,", big, "at 100");

  // And the point of all this: the baseline must actually hold level. The window
  // starts at t=2000 because the entrant pipeline's transient runs for several
  // careers — the population has to reach a stationary tenure structure before
  // "drift" means anything. Measured, meanE is still rising at t=1200 and level from
  // t=2000. Starting earlier would score the transient as drift.
  const before = app.sim.history.length;
  for (let i = 0; i < 3000; i++) doTick();
  const h = app.sim.history;
  const at2000 = h[2000 - 1 + before].meanE, at3000 = h[3000 - 1 + before].meanE;
  const drift = at3000 - at2000;
  if (Math.abs(drift) > 0.03) {
    throw new Error("baseline drifted " + drift.toFixed(4) + " between t=2000 and t=3000 under the steady-state preset");
  }
  console.log("OK: baseline held — meanE", at2000.toFixed(4), "->", at3000.toFixed(4),
    "drift", (drift >= 0 ? "+" : "") + drift.toFixed(4), "over 1,000 ticks past the transient");
}

console.log("\\n--- entrant pipeline: the page boots with a ladder, not a blob ---");
{
  const boot = createSim({ N: 800, M: 40, seed: 4 });
  if (!(boot.params.learningCap > 0)) throw new Error("the page should boot with learningCap on, got " + boot.params.learningCap);
  if (!(boot.params.seniorTenureYears > 0)) throw new Error("the page should boot learning from seniors");
  if (boot.params.decayRate !== ENGINE.PIPELINE_PARAMS.decayRate) throw new Error("the pipeline's re-fitted decay rate was not applied");
  if (!boot.tenure) throw new Error("tenure is not being tracked");

  // Run to where the ladder has formed (year 10 is enough — measured) and check the
  // distribution is spread, not the 0.025-wide point mass the old model settled into.
  for (let i = 0; i < 240; i++) tick(boot);
  const Es = Array.from(boot.E).sort((a, b) => a - b);
  const p10 = Es[Math.floor(0.1 * Es.length)], p90 = Es[Math.floor(0.9 * Es.length)];
  const below = Es.filter((e) => e < 0.585).length / Es.length;
  const p25 = Es[Math.floor(0.25 * Es.length)], p75 = Es[Math.floor(0.75 * Es.length)];
  if (p90 - p10 < 0.15) throw new Error("distribution is still a blob: p10-p90 spread " + (p90 - p10).toFixed(3));
  if (below < 0.08) throw new Error("almost nobody is below expert (" + (below * 100).toFixed(1) + "%) — the pipeline is not populated");
  // The IQR is the one that matters: a wide p10-p90 can come entirely from a thin
  // climbing tail while the other 80% sit in a single bin, which is exactly what the
  // page looked like before careers could differentiate after training.
  if (p75 - p25 < 0.15) throw new Error("the BODY of the distribution is still a point mass: IQR " + (p75 - p25).toFixed(3));
  console.log("OK: ladder present — p10", p10.toFixed(3), "p90", p90.toFixed(3),
    "IQR", (p75 - p25).toFixed(3), "|", (below * 100).toFixed(0) + "% still climbing");
}

console.log("\\n--- the page runs engine.js itself, not a copy ---");
{
  const eng = ENGINE;
  if (DEFAULT_PARAMS !== eng.DEFAULT_PARAMS) throw new Error("DEFAULT_PARAMS is not engine.js's object");
  if (MONTHLY_TICK_PARAMS !== eng.MONTHLY_TICK_PARAMS) throw new Error("MONTHLY_TICK_PARAMS is not engine.js's object");
  if (tick !== eng.tick) throw new Error("tick() is not engine.js's function");
  if (institutionStats !== eng.institutionStats) throw new Error("institutionStats() is not engine.js's function");
  // The page's createSim WRAPS the engine's initSim (monthly overlay + UI recording
  // buffers) under a deliberately different name — see the comment on it.
  if (typeof createSim !== "function") throw new Error("the page no longer defines createSim");
  if (createSim === eng.initSim) throw new Error("createSim should wrap the engine's initSim, not be it");
  const s = createSim({ N: 40, M: 6, seed: 1 });
  if (!s.instHistory || !s.snapshots || !s.aiToggleEvents) throw new Error("wrapper did not attach the UI recording buffers");
  console.log("OK: DEFAULT_PARAMS, MONTHLY_TICK_PARAMS, tick and institutionStats are engine.js's own");
}

console.log("\\n--- monthly tick base: the page boots on the calibrated set ---");
{
  const freshBoot = createSim({ N: 60, M: 8, seed: 1 }).params;
  Object.keys(ENGINE.MONTHLY_TICK_PARAMS).forEach((k) => {
    // The boot params, not just the constant: an overlay that is declared but not
    // applied would pass the check above and still run the legacy calibration.
    // Fresh sim rather than app.sim, which earlier flows in this driver have edited.
    //
    // The pipeline overlay is layered ON TOP of the monthly one and re-fits decayRate,
    // so where the two disagree the pipeline's value is the one that must win.
    const expected = k in ENGINE.PIPELINE_PARAMS ? ENGINE.PIPELINE_PARAMS[k] : ENGINE.MONTHLY_TICK_PARAMS[k];
    if (freshBoot[k] !== expected) {
      throw new Error("booted with " + k + " = " + freshBoot[k] + ", expected " + expected);
    }
  });
  if (TICKS_PER_YEAR !== 12) throw new Error("TICKS_PER_YEAR is " + TICKS_PER_YEAR + ", expected 12");
  if (fmtElapsed(0) !== "0y 0m" || fmtElapsed(480) !== "40y 0m" || fmtElapsed(19) !== "1y 7m") {
    throw new Error("fmtElapsed wrong: " + [fmtElapsed(0), fmtElapsed(480), fmtElapsed(19)].join(" "));
  }
  console.log("OK: booted monthly — beta =", freshBoot.transferRate,
    "delta =", freshBoot.decayRate,
    "r =", freshBoot.turnoverRate.toFixed(6), "(40y career), and 480 ticks reads as", fmtElapsed(480));
}

console.log("\\n--- settings snapshot: save, diverge, load from file, reproduce ---");
{
  // The claim being tested is REPRODUCTION, not that the fields come back. So: capture,
  // run a trajectory, wreck every axis the snapshot is meant to pin, then load the saved
  // text back through the real file-input handler and re-run. The second trajectory must
  // match tick for tick, which it only can if the seed and the structural fields
  // travelled with it.
  const loadBtn = document.getElementById("btnLoadSnapshot");
  const storeBtn = document.getElementById("btnStoreSnapshot");
  const snapInput = document.getElementById("fileSnapshot");
  if (!storeBtn || !loadBtn || !snapInput) throw new Error("snapshot controls not rendered into the sidebar");

  const rebuildWith = (N, M, seed) => {
    document.getElementById("fieldUseWorldModel").checked = false;   // BA graph: M is ours to set
    document.getElementById("fieldN").value = String(N);
    document.getElementById("fieldM").value = String(M);
    document.getElementById("fieldSeed").value = String(seed);
    document.getElementById("btnRebuild").dispatch("click");
  };
  const trajectory = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) { doTick(); out.push(app.sim.history[app.sim.history.length - 1].meanE); }
    return out;
  };

  rebuildWith(300, 12, 4242);
  app.sim.params.transferRate = 0.12;
  app.sim.params.decayRate = 0.031;
  const saved = snapshotJSON();                       // exactly what Store writes to the file
  const name = defaultSnapshotName();
  if (!/^capdecay-ba-N300-seed4242-\\d{4}-\\d{2}-\\d{2}\\.json$/.test(name)) {
    throw new Error("suggested filename does not describe the run: " + name);
  }
  if (JSON.parse(saved).params.seed !== 4242) throw new Error("snapshot did not capture the seed");
  const first = trajectory(40);

  // Diverge on every axis the snapshot is supposed to pin.
  rebuildWith(180, 7, 99);
  app.sim.params.transferRate = 0.28;
  app.sim.params.decayRate = 0.004;
  const wrong = trajectory(40);
  if (JSON.stringify(wrong) === JSON.stringify(first)) throw new Error("test is inert: the divergence did not change the run");

  // Clicking Load must open the picker — i.e. click the hidden file input.
  let picked = 0;
  snapInput.addEventListener("click", () => { picked++; });
  loadBtn.dispatch("click");
  if (picked !== 1) throw new Error("Load did not open the file picker");

  // Feed the saved text back through the real change handler.
  snapInput.dispatch("change", { target: { files: [{ name: "settings.json", _contents: saved }] } });
  const note = document.getElementById("snapshotNote").textContent;
  if (/could not load/.test(note)) throw new Error("load reported failure: " + note);
  if (app.sim.t !== 0) throw new Error("load must rebuild from t=0, t is " + app.sim.t);
  if (app.sim.N !== 300 || app.sim.M !== 12 || app.sim.params.seed !== 4242) {
    throw new Error("structural fields not restored: N=" + app.sim.N + " M=" + app.sim.M + " seed=" + app.sim.params.seed);
  }
  if (Math.abs(app.sim.params.transferRate - 0.12) > 1e-12 || Math.abs(app.sim.params.decayRate - 0.031) > 1e-12) {
    throw new Error("live parameters not restored: beta=" + app.sim.params.transferRate + " delta=" + app.sim.params.decayRate);
  }
  const again = trajectory(40);
  for (let i = 0; i < first.length; i++) {
    if (again[i] !== first[i]) {
      throw new Error("trajectory not reproduced at tick " + (i + 1) + ": " + again[i] + " vs " + first[i]);
    }
  }

  // A file that is not a settings file must be reported, not half-applied.
  const beforeN = app.sim.N;
  snapInput.dispatch("change", { target: { files: [{ name: "junk.json", _contents: '{"nope":1}' }] } });
  if (!/could not load junk/.test(document.getElementById("snapshotNote").textContent)) {
    throw new Error("a file with no params was not rejected: " + document.getElementById("snapshotNote").textContent);
  }
  if (app.sim.N !== beforeN) throw new Error("a rejected file must leave the current run untouched");

  console.log("OK: snapshot reproduced the run exactly over", first.length,
    "ticks after diverging on N, M, seed and two live dials; suggested name", name);
}

console.log("\\n--- timeline: mean / median / deciles are recorded and ordered ---");
{
  // The chart can only be right if the metrics behind it are. Percentiles come from a
  // 1000-bin histogram rather than a sort (a per-tick sort costs ~a third of tick time
  // at N=10500), so the checks are ordering and agreement with the actual population,
  // not exact equality.
  document.getElementById("fieldUseWorldModel").checked = false;
  document.getElementById("fieldN").value = "800";
  document.getElementById("fieldM").value = "20";
  document.getElementById("fieldSeed").value = "5";
  document.getElementById("btnRebuild").dispatch("click");
  for (let i = 0; i < 400; i++) doTick();

  const e = app.sim.history[app.sim.history.length - 1];
  for (const k of ["meanE", "p10E", "p50E", "p90E"]) {
    if (typeof e[k] !== "number" || !isFinite(e[k])) throw new Error("history is missing " + k + ": " + e[k]);
  }
  if (!(e.p10E <= e.p50E && e.p50E <= e.p90E)) {
    throw new Error("percentiles out of order: " + e.p10E + " " + e.p50E + " " + e.p90E);
  }
  // Against the population itself, allowing for the histogram's 0.001 bin width.
  const sorted = Array.from(app.sim.E).sort((x, y) => x - y);
  const exact = (q) => sorted[Math.ceil(q * sorted.length) - 1];
  [[0.10, e.p10E], [0.50, e.p50E], [0.90, e.p90E]].forEach(([q, got]) => {
    if (Math.abs(got - exact(q)) > 0.002) {
      throw new Error("p" + (q * 100) + " disagrees with the population: " + got + " vs " + exact(q));
    }
  });
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  if (Math.abs(e.meanE - mean) > 1e-6) throw new Error("meanE disagrees with the population");

  // And the chart itself must render over that history without throwing.
  drawSpreadChart();
  console.log("OK: p10 " + e.p10E.toFixed(3) + " < median " + e.p50E.toFixed(3) +
    " < p90 " + e.p90E.toFixed(3) + ", mean " + e.meanE.toFixed(3) + ", chart drew");
}

console.log("\\n--- expertise histogram: every non-empty bar is labelled with its headcount ---");
{
  // Counting what the histogram would draw, from the same snapshot it draws from, so the
  // labels cannot silently disagree with the bars. The label placement itself is geometry
  // the stub cannot verify — what it can verify is that a count exists for every bar, and
  // that the counts sum to the population.
  document.getElementById("fieldUseWorldModel").checked = false;
  document.getElementById("fieldN").value = "900";
  document.getElementById("fieldM").value = "20";
  document.getElementById("btnRebuild").dispatch("click");
  for (let i = 0; i < 300; i++) doTick();

  const snap = currentSnapshot();
  const bins = 20;
  const counts = new Array(bins).fill(0);
  for (let i = 0; i < snap.E.length; i++) counts[Math.min(bins - 1, Math.floor(snap.E[i] * bins))]++;
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== app.sim.N) throw new Error("bins hold " + total + " people but N is " + app.sim.N);
  const nonEmpty = counts.filter((c) => c > 0).length;
  if (nonEmpty < 2) throw new Error("expected a spread population to occupy several bins, got " + nonEmpty);
  // And drawing must survive both placements: a normal run, and one where a single bin
  // holds nearly everyone so its bar reaches the top and the label goes inside it.
  drawHistogram();
  for (let i = 0; i < app.sim.N; i++) app.sim.E[i] = 0.72;
  drawHistogram();
  console.log("OK: " + nonEmpty + " of " + bins + " bins occupied, " + total +
    " people accounted for, labels drew in both placements");
}

console.log("\\n--- transport: the speed slider is a pause-per-month scale ---");
{
  // The slider sets a PAUSE between ticks, not a rate: position 0 is a one-second pause,
  // the maximum position is no pause at all. Position is the single source of truth and
  // the pause is derived, so the two cannot drift apart.
  const el = document.getElementById("speedRange");
  if (parseInt(el.min, 10) !== 0) throw new Error("speed slider min should be 0, got " + el.min);
  if (parseInt(el.max, 10) !== SPEED_POS_MAX) throw new Error("speed slider max should be " + SPEED_POS_MAX + ", got " + el.max);
  if (parseInt(el.value, 10) !== app.speedPos) throw new Error("slider position does not match state at boot");

  setSpeed(0);
  if (app.tickPauseMs !== 1000) throw new Error("full left should pause one second per month, got " + app.tickPauseMs);
  setSpeed(SPEED_POS_MAX);
  if (app.tickPauseMs !== 0) throw new Error("full right should have no pause, got " + app.tickPauseMs);
  // Monotonic, and halving every two steps.
  let prev = Infinity;
  for (let p = 0; p < SPEED_POS_MAX; p++) {
    const v = pauseForPos(p);
    if (!(v < prev)) throw new Error("pause is not strictly decreasing at position " + p);
    prev = v;
  }
  if (Math.abs(pauseForPos(2) - 500) > 1e-9) throw new Error("two steps should halve the pause, got " + pauseForPos(2));

  // At no-pause the frame loop must still return, and must still advance the run. A
  // purely time-based loop never exits here: every tick finishes inside one millisecond,
  // so Date.now() does not move and only the iteration cap ends it.
  el._value = String(SPEED_POS_MAX);
  el.dispatch("input", { target: el });
  document.getElementById("fieldN").value = "200";
  document.getElementById("fieldM").value = "8";
  document.getElementById("btnRebuild").dispatch("click");
  setPlaying(true);
  const before = app.sim.t;
  pumpRAF(1, 16);
  setPlaying(false);
  const advanced = app.sim.t - before;
  if (advanced <= 1) throw new Error("no-pause mode advanced only " + advanced + " tick(s) in a frame");
  if (advanced > 200) throw new Error("no-pause mode ran " + advanced + " ticks in one frame — the cap did not hold");
  console.log("OK: pause runs 1000ms -> 0ms over " + (SPEED_POS_MAX + 1) +
    " positions; at 0 pause one frame advanced " + advanced + " months");
}

console.log("\\n--- every slider default is inside its own range and on-step ---");
{
  // The bug this guards: transfer_rate shipped with max 0.08 while its own default was
  // 0.5, so the range input clamped to 0.08 and could not be dragged past it.
  const boot = createSim({ N: 60, M: 8, seed: 1 }).params;
  PARAM_FIELDS.forEach((f) => {
    const v = boot[f.key];
    if (!f.desc) throw new Error(f.key + " has no hover description");
    if (typeof v !== "number") throw new Error(f.key + " has no numeric boot value");
    if (v < f.min || v > f.max) throw new Error(f.key + " boots at " + v + ", outside its slider range [" + f.min + ", " + f.max + "]");
    const steps = (v - f.min) / f.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) {
      throw new Error(f.key + " boots at " + v + ", which is not a multiple of step " + f.step + " from min " + f.min +
        " — the slider would snap to a different value than the model runs on");
    }
  });
  // Every slider must show its explanation ON SCREEN, not only in a title attribute.
  // The bug this guards: the learning-dynamics descriptions were rewritten and then
  // rendered nowhere, because desc becomes a hover-only title and only hint is drawn.
  // A tooltip takes ~1s to appear, never appears on touch, and is invisible to anyone
  // scanning the panel, so it cannot be a control's only explanation.
  PARAM_FIELDS.forEach((f) => {
    const root = document.getElementById("sidebar").querySelector('.field[data-key="' + f.key + '"]');
    if (!root) throw new Error(f.key + " did not render into the sidebar at all");
    // desc is the visible line and says WHAT the control is; hint is the optional note
    // behind the ?. A field with only a hint would render a caveat about a control it
    // never introduced, which is the regression this guards.
    if (!(f.desc || "").trim()) throw new Error(f.key + " has no desc — nothing tells the reader what this control is");
  });
  // ...and the concise ones must stay concise.
  PARAM_FIELDS.filter((f) => f.group === "learn").forEach((f) => {
    const words = f.desc.trim().split(/\s+/).length;
    if (words > 15) throw new Error(f.key + " desc is " + words + " words, over the 15-word limit for this group");
  });
  console.log("OK: all " + PARAM_FIELDS.length + " sliders in range, on-step, described and visibly labelled");

  // The ? actually opens the note. Driven through a real click, because a slot that is
  // rendered but never wired up passes every other check in this file silently — which
  // is how the diffusion panel and the identity hint both first "passed".
  {
    const withHint = PARAM_FIELDS.filter((f) => f.hint);
    if (!withHint.length) throw new Error("no field carries a hint — the ? affordance has nothing to show");
    withHint.forEach((f) => {
      const root = document.getElementById("sidebar").querySelector('.field[data-key="' + f.key + '"]');
      const why = root.querySelector(".why"), note = root.querySelector(".note");
      if (!why || !note) throw new Error(f.key + " has a hint but no ? / note element");
      if (note.classList.contains("is-open")) throw new Error(f.key + " note starts expanded");
      why.dispatch("click", { target: why });
      if (!note.classList.contains("is-open")) throw new Error(f.key + " note did not open on click");
      if (why.getAttribute("aria-expanded") !== "true") throw new Error(f.key + " ? did not report aria-expanded");
      why.dispatch("click", { target: why });
      if (note.classList.contains("is-open")) throw new Error(f.key + " note did not close again");
      if (why.getAttribute("aria-expanded") !== "false") throw new Error(f.key + " ? left aria-expanded true after closing");
    });
    // A field with no caveat must not sprout an empty ?.
    PARAM_FIELDS.filter((f) => !f.hint).forEach((f) => {
      const root = document.getElementById("sidebar").querySelector('.field[data-key="' + f.key + '"]');
      if (root.querySelector(".why")) throw new Error(f.key + " has no hint but rendered a ?");
    });
    console.log("OK: the ? opens and closes on all " + withHint.length + " fields that carry a note");
  }
}

console.log("\\nALL FLOWS COMPLETED WITHOUT THROWING");
`;

// simulator.html loads engine.js and world_model.js with <script src>. Those are
// CLASSIC scripts: in a browser they share ONE global lexical scope with the page's
// own inline <script>, so a name declared at top level in either file collides with
// the same name in the page and throws SyntaxError before anything runs.
//
// This harness therefore LOADS them the way a browser does — their source text, in
// the same vm context, before the page — rather than require()-ing them into their
// own module scope. Requiring them cannot reproduce a collision, which is how a
// seven-way one shipped in 2026-08 with every test green.
// The src attributes are READ OUT OF THE PAGE and resolved relative to it, exactly
// as a browser resolves them — not hardcoded here. Hardcoding meant the harness could
// keep loading a file the page no longer pointed at, so a page with a broken src
// still passed; the 2026-08 move to src/ + data/ changed one of these three paths and
// this is what makes that a test failure rather than a silent divergence.
const HTML_DIR = path.dirname(path.resolve(process.argv[2]));
const SRC_ATTRS = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
function readPageScript(basename) {
  const src = SRC_ATTRS.find((s) => path.basename(s) === basename);
  if (!src) {
    throw new Error(
      `${path.basename(process.argv[2])} has no <script src> ending in ${basename} — ` +
      `found: ${SRC_ATTRS.join(", ") || "(none)"}`
    );
  }
  return fs.readFileSync(path.resolve(HTML_DIR, src), "utf8");
}
const ENGINE_SRC = readPageScript("engine.js");
const WORLD_MODEL_SRC = readPageScript("world_model.js");
// world-model-data.js is deliberately NOT loaded in the main pass: that keeps the
// hand-picked-files path under test. A second, minimal pass at the bottom of this file
// loads it and checks the page boots ready.
const WORLD_MODEL_DATA_SRC = readPageScript("world-model-data.js");

// Minimal FileReader: the page reads user-chosen files with readAsText.
class FakeFileReader {
  readAsText(file) {
    this.result = file._contents;
    if (this.onload) this.onload();
  }
}

const sandbox = {
  document, window, MutationObserver, getComputedStyle, Date,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  console, Math, Set, Array, Object, Float32Array, Float64Array, Int32Array, Uint32Array,
  parseInt, parseFloat, isFinite, JSON,
  FileReader: FakeFileReader, Error, Number,
  drawnText,
  // The page's own markup, for checks about what it CONTAINS rather than what it does.
  PAGE_HTML: pageHTML,
  // Real project data — the browser path is exercised against the same files the
  // batch runner uses, not a synthetic fixture.
  WORLD_JSON_TEXT: fs.readFileSync(paths.data("world-model.json"), "utf8"),
  COSTS_JSON_TEXT: fs.readFileSync(paths.data("mobility-costs.json"), "utf8"),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// --- the two <script src> files, loaded as a browser loads them -------------
try {
  vm.runInContext(ENGINE_SRC, sandbox, { filename: "engine.js" });
  vm.runInContext(WORLD_MODEL_SRC, sandbox, { filename: "world_model.js" });
} catch (err) {
  console.error("\nTHREW loading a <script src> file:", err.stack || err);
  process.exitCode = 1;
  return;
}

// Each must publish EXACTLY its one global and leak nothing else into the scope the
// page shares with it. Probed by evaluating typeof in that scope rather than by
// inspecting globalThis: top-level const/let live in the global LEXICAL scope and
// never appear as properties, so a property check would miss most of a leak.
{
  const leaked = vm.runInContext(
    "[" + ["mulberry32", "tick", "initSim", "clip01", "DEFAULT_PARAMS", "EXPERT_THRESHOLD",
           "institutionStats", "AI_MODES", "loadWorldModel", "fnv1a", "DEFAULT_OPTS"]
      .map((n) => `["${n}", typeof ${n}]`).join(",") + "]", sandbox)
    .filter(([, t]) => t !== "undefined");
  if (leaked.length) {
    console.error("\nengine.js / world_model.js leak into the page's scope:",
      leaked.map(([n, t]) => `${n} (${t})`).join(", "),
      "\n  Any of these colliding with a page declaration is a SyntaxError that stops the whole page.");
    process.exitCode = 1;
  } else if (!sandbox.Engine || !sandbox.WorldModel) {
    console.error("\nexpected globalThis.Engine and globalThis.WorldModel to be published");
    process.exitCode = 1;
  } else {
    console.log("OK: engine.js and world_model.js publish only Engine / WorldModel, no leakage");
  }
}

// The browser branch of each dual-mode export must publish the same API the Node
// branch does — otherwise the page and batch_run.js are handed different surfaces.
{
  const nodeEngine = Object.keys(require("../engine.js")).sort().join(",");
  const vmEngine = Object.keys(sandbox.Engine).sort().join(",");
  if (nodeEngine !== vmEngine) {
    console.error("\nengine.js publishes a different API to Node than to the browser:\n  node: " +
      nodeEngine + "\n  browser: " + vmEngine);
    process.exitCode = 1;
  } else {
    console.log("OK: engine.js publishes an identical API under Node and in the browser");
  }
}

// The driver asserts the page is using the loaded engine, so point ENGINE at the one
// the page can actually see — the object the <script> above created in this context.
sandbox.ENGINE = sandbox.Engine;

try {
  vm.runInContext(scriptMatch[1] + "\n" + driver, sandbox, { filename: "app+driver.js" });
} catch (err) {
  console.error("\nTHREW:", err.stack || err);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Second pass: the page as a user actually opens it, with world-model-data.js
// alongside. The data must be live at boot — before any file picking — because that
// is what makes the world-model switch usable on arrival.
// ---------------------------------------------------------------------------
console.log("\n--- bundled world-model data: ready at boot ---");
{
  const registry2 = new Map();
  const el2 = (tag) => {
    const e = new FakeElement(tag);
    return e;
  };
  const doc2 = {
    documentElement: Object.assign(el2("html"), { getAttribute: () => null }),
    getElementById: (id) => { if (!registry2.has(id)) { const e = el2("div"); e._id = id; registry2.set(id, e); } return registry2.get(id); },
  };
  const sandbox2 = {
    document: doc2,
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {},
              requestAnimationFrame: () => 1, devicePixelRatio: 1 },
    requestAnimationFrame: () => 1,
    getComputedStyle: () => ({ getPropertyValue: () => "#336699" }),
    MutationObserver: class { observe() {} },
    console: { log() {}, warn() {}, error() {} },
    Math, Set, Array, Object, Float32Array, Float64Array, Int32Array, Uint32Array,
    parseInt, parseFloat, isFinite, JSON, Error, Number, FileReader: FakeFileReader,
  };
  sandbox2.globalThis = sandbox2;
  vm.createContext(sandbox2);
  vm.runInContext(ENGINE_SRC, sandbox2, { filename: "engine.js" });
  vm.runInContext(WORLD_MODEL_SRC, sandbox2, { filename: "world_model.js" });
  vm.runInContext(WORLD_MODEL_DATA_SRC, sandbox2, { filename: "world-model-data.js" });
  vm.runInContext(scriptMatch[1], sandbox2, { filename: "simulator.html (with bundled data)" });

  const state = vm.runInContext("({ M: worldModelState.loaded && worldModelState.loaded.M, source: worldModelState.source," +
    " error: worldModelState.error, graphSource: app.sim.params.graphSource, N: app.sim.N, status: worldModelStatusText() })", sandbox2);
  if (!state.M) throw new Error("bundled data did not build a world model: " + state.error);
  if (state.source !== "bundled") throw new Error("source should be 'bundled', got " + state.source);
  if (state.M !== 245) throw new Error("expected 245 institutions from the bundle, got " + state.M);
  // The page BOOTS into the world model when the bundle is present: WORLD_MODEL_PARAMS
  // was fitted on that graph at N=10500, so booting on the BA graph would show a
  // configuration nothing was calibrated for. Unticking the switch still gets you BA.
  if (state.graphSource !== "worldModel") throw new Error("bundle present but page did not boot into the world model, got " + state.graphSource);
  if (state.N !== 10500) throw new Error("expected the calibrated N=10500 at boot, got " + state.N);
  if (!/bundled with this page/.test(state.status)) throw new Error("status line does not say where the data came from: " + state.status);
  console.log("OK: booted with the bundle —", state.M, "institutions ready, booted into the world model at N=" + state.N);

  // --- the turnover slider reports whether the intake identity still holds ----------
  // Only meaningful here: the BA graph carries no intake data, so this reading exists
  // exactly in the mode this sandbox is in. Driven through the real input event rather
  // than by calling refreshLiveHint, so a slot that is never wired up still fails.
  const idn = vm.runInContext(`(() => {
    const root = document.getElementById("sidebar").querySelector('.field[data-key="turnoverRate"]');
    if (!root) return { err: "no turnover field" };
    const el = root.querySelector(".live-hint");
    if (!el) return { err: "turnover field has no live-hint slot" };
    const input = root.querySelector("input");
    const read = () => ({ text: el.textContent, warn: el.classList.contains("is-warn") });
    const atBoot = read();
    // Halve the career length. N is structural and does not follow, so the identity
    // must now be reported as broken.
    input.value = String(1 / (20 * 12));
    input.dispatch("input", { target: input });
    const halved = read();
    input.value = String(1 / (40 * 12));
    input.dispatch("input", { target: input });
    return { atBoot, halved, restored: read(), n: app.sim.params.N };
  })()`, sandbox2);
  if (idn.err) throw new Error("live identity hint: " + idn.err);
  if (!idn.atBoot.text) throw new Error("turnover live hint is empty at boot");
  if (idn.atBoot.warn) throw new Error("shipped config reported as breaking the identity: " + idn.atBoot.text);
  if (!/40y career/.test(idn.atBoot.text)) throw new Error("boot hint does not state the career length: " + idn.atBoot.text);
  if (!idn.halved.warn) throw new Error("a 20y career at N=" + idn.n + " should warn, got: " + idn.halved.text);
  if (!/Rebuild/.test(idn.halved.text)) throw new Error("warning does not say what to do: " + idn.halved.text);
  if (idn.restored.warn) throw new Error("restoring the calibrated rate left the warning on: " + idn.restored.text);
  console.log("OK: identity hint —", JSON.stringify(idn.atBoot.text));
  console.log("    at a 20y career —", JSON.stringify(idn.halved.text));
  console.log("   status:", state.status);
}
