// Minimal DOM stub to execute the simulator's <script> body under Node and
// exercise its main control flows (no real rendering — canvas ops are no-ops).
// Driver code is concatenated onto the SAME script text as the app so it can
// see the app's top-level `const`/function declarations (vm.runInContext
// does not expose script-level const/let on the context object).
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const registry = new Map();

const CTX_STUB = new Proxy({}, {
  get(target, prop) { return prop in target ? target[prop] : function () {}; },
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
    this._attrs = {}; this._fieldMap = {}; this.style = {}; this.children = [];
    this._listeners = new Listeners();
    this.classList = { add: () => {}, remove: () => {}, contains: () => false };
    this._max = "";
  }
  get id() { return this._id; }
  set id(v) { this._id = v; registry.set(v, this); }
  get value() { return this._value; }
  set value(v) { this._value = String(v); }
  get max() { return this._max; }
  set max(v) { this._max = String(v); }
  get checked() { return this._checked; }
  set checked(v) { this._checked = !!v; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get title() { return this._attrs.title || ""; }
  set title(v) { this._attrs.title = v; }
  set innerHTML(html) { this._html = html; registerIdsFromHTML(html); this._fieldMap = parseFieldBlocks(html); }
  get innerHTML() { return this._html; }
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
    return null;
  }
}

function makeFieldStub(initialValue, initialText) {
  const root = new FakeElement("div");
  const input = new FakeElement("input"); input.value = initialValue;
  const output = new FakeElement("output"); output.textContent = initialText;
  root._input = input; root._output = output;
  root.querySelector = (sel) => (sel === "input" ? input : sel === "output" ? output : null);
  return root;
}

function parseFieldBlocks(html) {
  const map = {};
  // Trailing [^>]* so extra attributes on the wrapper (e.g. the hover-description
  // title=) don't stop a field being found.
  const re = /<div class="field" data-key="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const key = m[1], block = m[2];
    const outM = block.match(/<output>([^<]*)<\/output>/);
    const valM = block.match(/<input[^>]*value="([^"]*)"/);
    map[key] = makeFieldStub(valM ? valM[1] : "0", outM ? outM[1] : "");
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

const staticIds = [
  "statT", "statN", "statM", "aiChip", "btnStep", "btnPlay", "speedRange", "speedOut",
  "btnRebuild", "scrubRange", "scrubLabel", "btnLive", "sidebar", "networkCanvas",
  "distCanvas", "gapCanvas", "divCanvas", "expertCanvas", "inspector",
];
staticIds.forEach((id) => {
  const tag = id.includes("Canvas") ? "canvas" : id === "sidebar" || id === "inspector" ? "aside" : "div";
  const el = new FakeElement(tag);
  el._id = id;
  registry.set(id, el);
});
registry.get("scrubRange")._value = "0";
registry.get("scrubRange")._max = "0";
registry.get("speedRange")._value = "6";

const documentElement = new FakeElement("html");
documentElement.getAttribute = () => null;

const document = { documentElement, getElementById: (id) => registry.get(id) || null };

const window = {
  devicePixelRatio: 1,
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  addEventListener: () => {},
  _rafQueue: [],
  requestAnimationFrame(fn) { window._rafQueue.push(fn); return window._rafQueue.length; },
};
class MutationObserver { constructor(cb) { this.cb = cb; } observe() {} }
function getComputedStyle() { return { getPropertyValue: () => "#336699" }; }

function pumpRAFSrc() {} // placeholder, real pump lives in driver code below (has access to window)

const html = fs.readFileSync(process.argv[2], "utf8");
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

console.log("--- toggling AI on, resuming play ---");
const aiCheckbox = document.getElementById("fieldAiEnabled");
aiCheckbox.checked = true;
aiCheckbox.dispatch("change", { target: aiCheckbox });
console.log("OK: aiEnabled =", app.sim.params.aiEnabled, "toggle events =", app.sim.aiToggleEvents.length);
const tBeforeAI = app.sim.t;
document.getElementById("btnPlay").dispatch("click"); // resume (was paused after the step above)
pumpRAF(30, 1000/6);
document.getElementById("btnPlay").dispatch("click"); // pause again
console.log("after AI on + running: t =", app.sim.t, "last gap =", app.sim.history[app.sim.history.length-1].gap);
if (app.sim.t <= tBeforeAI) throw new Error("sim did not advance after resuming play");
if (!(app.sim.history[app.sim.history.length-1].gap > 0)) throw new Error("gap should be > 0 once AI is on and ticks have run");

console.log("--- switching AI response mode to exponential ---");
const aiModeSel = document.getElementById("fieldAiMode");
aiModeSel.value = "exponential";
aiModeSel.dispatch("change", { target: aiModeSel });
console.log("OK: aiResponseMode =", app.sim.params.aiResponseMode);
if (app.sim.params.aiResponseMode !== "exponential") throw new Error("ai mode select did not apply");

console.log("--- switching mobility mode ---");
const mobSel = document.getElementById("fieldMobilityMode");
mobSel.value = "edge_constrained";
mobSel.dispatch("change", { target: mobSel });
console.log("OK: mobilityMode =", app.sim.params.mobilityMode);
if (app.sim.params.mobilityMode !== "edge_constrained") throw new Error("mobility mode select did not apply");

console.log("--- network node click -> inspector ---");
app.selectedInst = 0;
renderInspector();
console.log("OK: renderInspector ran, inspector html length =", document.getElementById("inspector").innerHTML.length);
if (document.getElementById("inspector").innerHTML.indexOf("Institution 0") === -1) throw new Error("inspector did not render selected institution");

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
if (app.sim.params.aiEnabled !== true || app.sim.params.aiResponseMode !== "exponential") {
  throw new Error("rebuild did not preserve live params (aiEnabled/aiResponseMode)");
}

console.log("--- adjusting the atrophy multiplier slider ---");
const atrophyField = document.getElementById("sidebar").querySelector('.field[data-key="aiAtrophyMultiplier"]');
if (!atrophyField) throw new Error("aiAtrophyMultiplier field not found in sidebar");
const atrophyInput = atrophyField.querySelector("input");
atrophyInput.value = "3.2";
atrophyInput.dispatch("input", { target: atrophyInput });
console.log("OK: aiAtrophyMultiplier =", app.sim.params.aiAtrophyMultiplier);
if (Math.abs(app.sim.params.aiAtrophyMultiplier - 3.2) > 1e-9) throw new Error("atrophy slider did not update sim params");

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

console.log("\\n--- world model: toggle refuses to turn on with nothing loaded ---");
var wmToggle = document.getElementById("fieldUseWorldModel");
wmToggle.checked = true;
wmToggle.dispatch("change");
console.log("OK: toggle self-cleared =", wmToggle.checked === false);
if (wmToggle.checked !== false) throw new Error("toggle should refuse to enable before both files load");
if (readStructuralFields().graphSource !== "ba") throw new Error("graphSource should still be ba");

console.log("\\n--- world model: loading both files ---");
document.getElementById("fileWorldModel").dispatch("change",
  { target: { files: [{ name: "world-model.json", _contents: WORLD_JSON_TEXT }] } });
document.getElementById("fileMobilityCosts").dispatch("change",
  { target: { files: [{ name: "mobility-costs.json", _contents: COSTS_JSON_TEXT }] } });
if (!worldModelState.loaded) throw new Error("world model did not build: " + worldModelState.error);
console.log("OK: built M =", worldModelState.loaded.M, "fingerprint =", worldModelState.loaded.fingerprint);
console.log("OK: toggle auto-enabled =", document.getElementById("fieldUseWorldModel").checked);

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

console.log("\\n--- world model: mobility_friction slider is live ---");
var fricField = document.getElementById("sidebar").querySelector('.field[data-key="mobilityFriction"]');
if (!fricField) throw new Error("mobilityFriction field not found in sidebar");
var fricInput = fricField.querySelector("input");
fricInput.value = "0.4";
fricInput.dispatch("input", { target: fricInput });
console.log("OK: mobilityFriction =", app.sim.params.mobilityFriction);
if (app.sim.params.mobilityFriction !== 0.4) throw new Error("friction slider did not apply");
for (var wf = 0; wf < 5; wf++) doTick();
console.log("OK: ticked with friction on, t =", app.sim.t);

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
  ["aiDampeningBelow", "aiDampeningAbove", "aiAtrophyMultiplier"].forEach((k) => {
    if (!field(k)) throw new Error("AI group is missing " + k + " — all three are settable now, none is derived");
  });
  if (field("aiRelianceIntensity")) throw new Error("rho slider is back; it was removed");
  if ("aiRelianceIntensity" in ai()) throw new Error("rho leaked into params");
  if (document.getElementById("fieldCoupleReliance")) throw new Error("couple_reliance toggle is back; it was removed");

  // Each moves only itself — no derivation, no cross-talk.
  const before = { b: ai().aiDampeningBelow, a: ai().aiDampeningAbove, m: ai().aiAtrophyMultiplier };
  const inp = field("aiDampeningBelow").querySelector("input");
  inp.value = "1.4";
  inp.dispatch("input");
  if (Math.abs(ai().aiDampeningBelow - 1.4) > 1e-9) throw new Error("gamma_below slider did not take");
  if (ai().aiDampeningAbove !== before.a || ai().aiAtrophyMultiplier !== before.m) {
    throw new Error("moving gamma_below moved another dial — nothing should be coupled now");
  }
  console.log("OK: gamma_below =", ai().aiDampeningBelow, "| gamma_above and mu_atr untouched");

  // The ablation the old coupling forbade is now expressible: learning blocked,
  // no atrophy. It is a mechanism probe, not an incoherent state.
  const gB = field("aiDampeningBelow").querySelector("input");
  const mA = field("aiAtrophyMultiplier").querySelector("input");
  gB.value = "0"; gB.dispatch("input");
  mA.value = "1"; mA.dispatch("input");
  const tPre = app.sim.t;
  for (let i = 0; i < 5; i++) document.getElementById("btnStep").dispatch("click");
  if (app.sim.t !== tPre + 5) throw new Error("stepping in the ablation state did not advance 5 ticks");
  console.log("OK: learning-blocked / no-atrophy ablation runs, t =", app.sim.t);

  // A Rebuild carries the live triple through untouched.
  document.getElementById("btnRebuild").dispatch("click");
  if (app.sim.params.aiDampeningBelow !== 0 || app.sim.params.aiAtrophyMultiplier !== 1) {
    throw new Error("rebuild did not preserve the AI dials: " + app.sim.params.aiDampeningBelow + "/" + app.sim.params.aiAtrophyMultiplier);
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
console.log("\\n--- the page runs engine.js itself, not a copy ---");
{
  const eng = ENGINE;
  if (DEFAULT_PARAMS !== eng.DEFAULT_PARAMS) throw new Error("DEFAULT_PARAMS is not engine.js's object");
  if (MONTHLY_TICK_PARAMS !== eng.MONTHLY_TICK_PARAMS) throw new Error("MONTHLY_TICK_PARAMS is not engine.js's object");
  if (tick !== eng.tick) throw new Error("tick() is not engine.js's function");
  if (institutionStats !== eng.institutionStats) throw new Error("institutionStats() is not engine.js's function");
  // The page's initSim WRAPS the engine's (monthly overlay + UI recording buffers),
  // so it is deliberately not the same function — but it must call through.
  if (initSim === eng.initSim) throw new Error("the page's initSim should wrap the engine's, not be it");
  const s = initSim({ N: 40, M: 6, seed: 1 });
  if (!s.instHistory || !s.snapshots || !s.aiToggleEvents) throw new Error("wrapper did not attach the UI recording buffers");
  console.log("OK: DEFAULT_PARAMS, MONTHLY_TICK_PARAMS, tick and institutionStats are engine.js's own");
}

console.log("\\n--- monthly tick base: the page boots on the calibrated set ---");
{
  const freshBoot = initSim({ N: 60, M: 8, seed: 1 }).params;
  Object.keys(ENGINE.MONTHLY_TICK_PARAMS).forEach((k) => {
    // The boot params, not just the constant: an overlay that is declared but not
    // applied would pass the check above and still run the legacy calibration.
    // Fresh sim rather than app.sim, which earlier flows in this driver have edited.
    if (freshBoot[k] !== ENGINE.MONTHLY_TICK_PARAMS[k]) {
      throw new Error("booted with " + k + " = " + freshBoot[k] + ", expected the calibrated " + ENGINE.MONTHLY_TICK_PARAMS[k]);
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

console.log("\\n--- every slider default is inside its own range and on-step ---");
{
  // The bug this guards: transfer_rate shipped with max 0.08 while its own default was
  // 0.5, so the range input clamped to 0.08 and could not be dragged past it.
  const boot = initSim({ N: 60, M: 8, seed: 1 }).params;
  PARAM_FIELDS.forEach((f) => {
    const v = boot[f.key];
    if (!f.desc) throw new Error(f.key + " has no hover description");
    // null is a legitimate boot value for aiRelianceIntensity: it means decoupled, and
    // the slider is not rendered at all in that state.
    if (v === null) return;
    if (typeof v !== "number") throw new Error(f.key + " has no numeric boot value");
    if (v < f.min || v > f.max) throw new Error(f.key + " boots at " + v + ", outside its slider range [" + f.min + ", " + f.max + "]");
    const steps = (v - f.min) / f.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) {
      throw new Error(f.key + " boots at " + v + ", which is not a multiple of step " + f.step + " from min " + f.min +
        " — the slider would snap to a different value than the model runs on");
    }
  });
  console.log("OK: all " + PARAM_FIELDS.length + " sliders in range, on-step, and described");
}

console.log("\\nALL FLOWS COMPLETED WITHOUT THROWING");
`;

// simulator.html pulls the loader in with <script src="world_model.js">, which the
// stub doesn't execute — so inject the real module here. This is deliberate: the
// browser path and batch_run.js then share one implementation, and there is no
// second copy to drift.
const WorldModel = require("./world_model.js");

// Minimal FileReader: the page reads user-chosen files with readAsText.
class FakeFileReader {
  readAsText(file) {
    this.result = file._contents;
    if (this.onload) this.onload();
  }
}

const sandbox = {
  document, window, MutationObserver, getComputedStyle,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  console, Math, Set, Array, Object, Float32Array, Float64Array, Int32Array, Uint32Array,
  parseInt, parseFloat, isFinite, JSON,
  WorldModel, FileReader: FakeFileReader, Error, Number,
  // simulator.html does <script src="engine.js">, which in a browser lands on
  // globalThis.Engine. The stub has no script loader, so hand the page the real
  // module under that name — the same object require() returns here, which is what
  // lets the driver assert identity rather than mere equality.
  Engine: require("./engine.js"),
  ENGINE: require("./engine.js"),
  // Real project data — the browser path is exercised against the same files the
  // batch runner uses, not a synthetic fixture.
  WORLD_JSON_TEXT: fs.readFileSync(path.join(__dirname, "world-model.json"), "utf8"),
  COSTS_JSON_TEXT: fs.readFileSync(path.join(__dirname, "mobility-costs.json"), "utf8"),
};
vm.createContext(sandbox);

try {
  vm.runInContext(scriptMatch[1] + "\n" + driver, sandbox, { filename: "app+driver.js" });
} catch (err) {
  console.error("\nTHREW:", err.stack || err);
  process.exitCode = 1;
}
