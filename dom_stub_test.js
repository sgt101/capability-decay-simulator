// Minimal DOM stub to execute the simulator's <script> body under Node and
// exercise its main control flows (no real rendering — canvas ops are no-ops).
// Driver code is concatenated onto the SAME script text as the app so it can
// see the app's top-level `const`/function declarations (vm.runInContext
// does not expose script-level const/let on the context object).
const fs = require("fs");
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
  const re = /<div class="field" data-key="([^"]+)">([\s\S]*?)<\/div>/g;
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
console.log("\\nALL FLOWS COMPLETED WITHOUT THROWING");
`;

const sandbox = {
  document, window, MutationObserver, getComputedStyle,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  console, Math, Set, Array, Object, Float32Array, Float64Array, Int32Array, Uint32Array,
  parseInt, parseFloat, isFinite, JSON,
};
vm.createContext(sandbox);

try {
  vm.runInContext(scriptMatch[1] + "\n" + driver, sandbox, { filename: "app+driver.js" });
} catch (err) {
  console.error("\nTHREW:", err.stack || err);
  process.exitCode = 1;
}
