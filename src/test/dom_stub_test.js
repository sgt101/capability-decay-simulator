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
const CTX_STUB = new Proxy({}, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (prop === "measureText") return (str) => ({ width: String(str).length * 6 });
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
    this._attrs = {}; this._fieldMap = {}; this.style = {}; this.children = [];
    this._listeners = new Listeners();
    this.classList = { add: () => {}, remove: () => {}, contains: () => false };
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
  "statT", "statN", "statM", "aiChip", "btnStep", "btnPlay", "speedRange",
  "btnRebuild", "scrubRange", "scrubLabel", "btnLive", "sidebar", "networkCanvas",
  "distCanvas", "distCounters", "divCanvas", "spreadCanvas", "inspector",
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
    const shown = (f.hint || f.desc || "").trim();
    if (!shown) throw new Error(f.key + " has no visible explanation");
  });
  // ...and the concise ones must stay concise.
  PARAM_FIELDS.filter((f) => f.group === "learn").forEach((f) => {
    const words = f.desc.trim().split(/\s+/).length;
    if (words > 15) throw new Error(f.key + " desc is " + words + " words, over the 15-word limit for this group");
  });
  console.log("OK: all " + PARAM_FIELDS.length + " sliders in range, on-step, described and visibly labelled");
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
  console.log("   status:", state.status);
}
