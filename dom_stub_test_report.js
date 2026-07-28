// Minimal DOM stub to execute report.html's script end-to-end under Node —
// same rationale as dom_stub_test.js: no browser is available in this sandbox.
const fs = require("fs");
const vm = require("vm");

const registry = new Map();
const CTX_STUB = new Proxy({}, {
  get(t, p) { return p in t ? t[p] : function () {}; },
  set(t, p, v) { t[p] = v; return true; },
});

const CSS_VARS = {
  "--bg": "#eef0ee", "--panel": "#ffffff", "--ink": "#14181a", "--ink-muted": "#5c6360", "--ink-faint": "#8b918d",
  "--rule": "#d7dad6", "--accent": "#a8502c", "--accent2": "#35636b",
  "--diverge-zero": "#e4e2dc", "--diverge-pos-mid": "#a8502c", "--diverge-pos-end": "#5c2712",
  "--diverge-neg-mid": "#2a78d6", "--diverge-neg-end": "#0d366b",
};

class Listeners { constructor() { this.map = {}; } add(t, f) { (this.map[t] = this.map[t] || []).push(f); } fire(t, e) { (this.map[t] || []).forEach((f) => f(e)); } }

class FakeElement {
  constructor(tag) {
    this.tagName = (tag || "div").toUpperCase();
    this._id = ""; this._value = ""; this._max = ""; this._text = ""; this._html = "";
    this.style = {}; this._listeners = new Listeners();
    this.classList = { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false };
    this.children = [];
  }
  get id() { return this._id; } set id(v) { this._id = v; registry.set(v, this); }
  get value() { return this._value; } set value(v) { this._value = String(v); }
  get max() { return this._max; } set max(v) { this._max = String(v); }
  get textContent() { return this._text; } set textContent(v) { this._text = String(v); }
  get innerHTML() { return this._html; } set innerHTML(v) { this._html = v; }
  addEventListener(t, f) { this._listeners.add(t, f); }
  dispatch(t, e) { this._listeners.fire(t, e || { target: this }); }
  appendChild(c) { this.children.push(c); return c; }
  getBoundingClientRect() { return { width: 900, height: 480, left: 0, top: 0 }; }
  getContext() { return CTX_STUB; }
}

const staticIds = [
  "metaLine", "metricSelect", "tickLabel", "tickRange", "tickField",
  "tabHeatmap", "tabTable", "tabTrajectories", "axesFlipBtn",
  "expList", "fixedPanel",
  "heatmapPanel", "heatmapTitle", "heatmapSub", "heatmapWrap", "heatmapCanvas", "tableWrap",
  "legendMin", "legendMax", "legendRamp", "legendZero", "heatmapCaption",
  "trajectoryPanel", "trajTitle", "trajSub",
  "trajFixAxisSelect", "trajValueASelect", "trajValueBSelect",
  "trajHeadA", "trajHeadB", "trajWrapA", "trajWrapB", "trajCanvasA", "trajCanvasB",
  "trajLegendMin", "trajLegendMax", "trajLegendRamp", "trajLegendLabel", "trajCaption",
];
staticIds.forEach((id) => { const el = new FakeElement(id.includes("Canvas") ? "canvas" : "div"); el._id = id; registry.set(id, el); });

const documentElement = new FakeElement("html");
documentElement.getAttribute = () => null;
const document = {
  documentElement,
  getElementById: (id) => registry.get(id) || null,
  createElement: (tag) => new FakeElement(tag),
};
const window = {
  devicePixelRatio: 1,
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  addEventListener: () => {},
};
class MutationObserver { constructor(cb) { this.cb = cb; } observe() {} }
function getComputedStyle() { return { getPropertyValue: (name) => CSS_VARS[name] || "#888888" }; }

const html = fs.readFileSync(process.argv[2], "utf8");
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
if (!scriptMatch) throw new Error("no <script> found");

const driver = `
console.log("OK: initial render — experiments loaded:", DATA.experiments.length);
if (DATA.experiments.length !== 55) throw new Error("expected 55 experiments, got " + DATA.experiments.length);

console.log("current experiment:", currentExperiment().xKey, "x", currentExperiment().yKey);
console.log("domains:", JSON.stringify(DATA.domains[app.metricKey]));

console.log("--- switching to experiment index 5 (via click) ---");
const expList = document.getElementById("expList");
if (expList.children.length !== 55) throw new Error("expected 55 rendered experiment list items, got " + expList.children.length);
expList.children[5].dispatch("click");
if (app.expIndex !== 5) throw new Error("experiment click did not switch app.expIndex");
console.log("OK: switched to", currentExperiment().xKey, "x", currentExperiment().yKey);

console.log("--- checking per-figure captions (axis explanations + held-fixed values) ---");
{
  const exp5 = currentExperiment();
  const heatmapCaption = document.getElementById("heatmapCaption");
  const trajCaption = document.getElementById("trajCaption");
  if (!heatmapCaption.innerHTML || !trajCaption.innerHTML) throw new Error("figure captions were not populated");
  if (heatmapCaption.innerHTML !== trajCaption.innerHTML) throw new Error("heatmap and trajectory captions disagree for the same experiment");
  if (!heatmapCaption.innerHTML.includes(pretty(exp5.xKey)) || !heatmapCaption.innerHTML.includes(pretty(exp5.yKey))) {
    throw new Error("caption is missing one of the varying axis names");
  }
  if (!heatmapCaption.innerHTML.includes(PARAM_EXPLAIN[exp5.xKey]) || !heatmapCaption.innerHTML.includes(PARAM_EXPLAIN[exp5.yKey])) {
    throw new Error("caption is missing the intuitive explanation text for a varying axis");
  }
  const otherKeys = Object.keys(exp5.fixed).filter((k) => k !== exp5.xKey && k !== exp5.yKey);
  if (otherKeys.length < 10) throw new Error("expected many other fixed parameters to be listed, got " + otherKeys.length);
  const sampleKey = otherKeys[0];
  if (!heatmapCaption.innerHTML.includes(pretty(sampleKey))) throw new Error("caption is missing a held-fixed parameter: " + sampleKey);
  console.log("OK: caption lists both varying-axis explanations and " + otherKeys.length + " held-fixed parameters");
}

console.log("--- checking axis flip button ---");
{
  const exp = currentExperiment();
  const realXKey = exp.xKey, realYKey = exp.yKey;
  const t0 = exp.ticks[app.tickIndex];
  const beforeCell = cellAt(exp, 2, 3, t0);
  if (!beforeCell) throw new Error("expected a cell at display (2,3) before flip");

  document.getElementById("axesFlipBtn").dispatch("click");
  if (!app.axesFlipped) throw new Error("flip button click did not set app.axesFlipped");

  const titleHtml = document.getElementById("heatmapTitle").innerHTML;
  if (!(titleHtml.indexOf(pretty(realYKey)) >= 0 && titleHtml.indexOf(pretty(realYKey)) < titleHtml.indexOf(pretty(realXKey)))) {
    throw new Error("heatmap title did not swap axis order after flip: " + titleHtml);
  }

  const capHtml = document.getElementById("heatmapCaption").innerHTML;
  if (!(capHtml.indexOf(pretty(realYKey)) >= 0 && capHtml.indexOf(pretty(realYKey)) < capHtml.indexOf(pretty(realXKey)))) {
    throw new Error("figure caption did not swap axis order after flip: " + capHtml);
  }

  // the same underlying cell should now be reachable at the TRANSPOSED display position
  const afterCell = cellAt(exp, 3, 2, t0);
  if (!afterCell || afterCell.x !== beforeCell.x || afterCell.y !== beforeCell.y) {
    throw new Error("flipped cellAt(3,2) did not resolve to the same underlying cell as unflipped cellAt(2,3)");
  }

  document.getElementById("tabTable").dispatch("click");
  const tableHtml = document.getElementById("tableWrap").innerHTML;
  // table header is "rowKey \\ colKey" i.e. dispYKey first — after flip dispYKey is
  // the ORIGINAL xKey, so that's what should now lead the header, not realYKey.
  if (!tableHtml.includes(">" + pretty(realXKey) + " \\\\")) throw new Error("table header did not swap after flip: " + tableHtml.slice(0, 200));
  document.getElementById("tabHeatmap").dispatch("click");

  document.getElementById("tabTrajectories").dispatch("click");
  const fixSelHtml = document.getElementById("trajFixAxisSelect").innerHTML;
  if (!fixSelHtml.includes('value="x">' + sym(realYKey))) throw new Error("trajectory fix-axis dropdown did not relabel after flip: " + fixSelHtml);
  document.getElementById("tabHeatmap").dispatch("click");

  document.getElementById("axesFlipBtn").dispatch("click");
  if (app.axesFlipped) throw new Error("second click did not turn the flip back off");
  const revertedCell = cellAt(exp, 2, 3, t0);
  if (!revertedCell || revertedCell.x !== beforeCell.x || revertedCell.y !== beforeCell.y) {
    throw new Error("un-flipping did not restore the original cell mapping");
  }
  console.log("OK: flip swaps heatmap title, caption, table headers, and trajectory dropdown, transposes cell lookup, and reverts cleanly");
}

console.log("--- switching metric ---");
const metricSelect = document.getElementById("metricSelect");
const secondMetric = DATA.metrics[1].key;
metricSelect.value = secondMetric;
metricSelect.dispatch("change", { target: metricSelect });
if (app.metricKey !== secondMetric) throw new Error("metric select did not update app.metricKey");
console.log("OK: metric =", app.metricKey);

console.log("--- moving tick slider ---");
const tickRange = document.getElementById("tickRange");
tickRange.value = "3";
tickRange.oninput();
if (app.tickIndex !== 3) throw new Error("tick slider did not update app.tickIndex");
console.log("OK: tickIndex =", app.tickIndex, "-> t =", currentExperiment().ticks[app.tickIndex]);

console.log("--- table view tab ---");
document.getElementById("tabTable").dispatch("click");
if (app.viewMode !== "table") throw new Error("table tab did not switch app.viewMode");
const tableHtml = document.getElementById("tableWrap").innerHTML;
if (!tableHtml.includes("<table")) throw new Error("table view did not render a table");
console.log("OK: table view rendered,", (tableHtml.match(/<tr>/g) || []).length, "rows");
document.getElementById("tabHeatmap").dispatch("click");
if (app.viewMode !== "heatmap") throw new Error("heatmap tab did not switch back");

console.log("--- simulating hover over the heatmap ---");
const canvas = document.getElementById("heatmapCanvas");
if (!canvas._hit) throw new Error("heatmap canvas never populated _hit (drawHeatmap not called?)");
const hit = hitTest(canvas, { clientX: 150, clientY: 100 });
console.log("hitTest result:", JSON.stringify(hit));
canvas.dispatch("mousemove", { clientX: 150, clientY: 100 });
console.log("OK: mousemove handled without throwing");

console.log("--- verifying every experiment renders without throwing ---");
for (let i = 0; i < DATA.experiments.length; i++) {
  app.expIndex = i;
  app.tickIndex = 0;
  onExperimentChange();
  app.tickIndex = currentExperiment().ticks.length - 1;
  render();
}
console.log("OK: all " + DATA.experiments.length + " experiments rendered at first and last tick without throwing");

// The "every experiment renders" loop above leaves app.expIndex at whatever the last
// experiment happens to be — with 55 experiments that's no longer guaranteed to touch
// a dampening key, so explicitly land on the aiDampeningBelow x aiDampeningAbove pair
// (still experiment.15 / index 14 — appending the five new params after the original
// six preserved this numbering) before the trajectories section, which specifically
// needs a dampening axis for its display-shift regression check below.
app.expIndex = DATA.experiments.findIndex((e) => e.xKey === "aiDampeningBelow" && e.yKey === "aiDampeningAbove");
if (app.expIndex < 0) throw new Error("could not find the aiDampeningBelow x aiDampeningAbove experiment");
onExperimentChange();

console.log("--- switching to trajectories view ---");
document.getElementById("tabTrajectories").dispatch("click");
if (app.viewMode !== "trajectories") throw new Error("tab click did not switch viewMode");
if (document.getElementById("trajectoryPanel").style.display !== "block") throw new Error("trajectory panel not shown");
if (document.getElementById("heatmapPanel").style.display !== "none") throw new Error("heatmap panel not hidden");
console.log("OK: trajValueA=", app.trajValueA, "trajValueB=", app.trajValueB, "fixAxis=", app.trajFixAxis);
if (app.trajValueA == null || app.trajValueB == null) throw new Error("trajectory defaults were not populated");
if (!document.getElementById("trajCanvasA")._hit) throw new Error("trajCanvasA never drew (no _hit populated)");
if (!document.getElementById("trajCanvasB")._hit) throw new Error("trajCanvasB never drew");

console.log("--- flipping the fixed axis ---");
const fixSel = document.getElementById("trajFixAxisSelect");
fixSel.value = "y";
fixSel.onchange();
if (app.trajFixAxis !== "y") throw new Error("fix-axis select did not update app.trajFixAxis");
console.log("OK: after flip, trajValueA=", app.trajValueA, "trajValueB=", app.trajValueB);

console.log("--- changing panel A's held value ---");
const selA = document.getElementById("trajValueASelect");
const newVal = currentExperiment().yValues[currentExperiment().yValues.length - 1];
selA.value = String(newVal);
selA.onchange();
if (Math.abs(app.trajValueA - newVal) > 1e-9) throw new Error("value-A select did not update app.trajValueA");
console.log("OK: trajValueA =", app.trajValueA);

console.log("--- simulating hover over trajectory panel A ---");
const trajA = document.getElementById("trajCanvasA");
trajA.dispatch("mousemove", { clientX: 150, clientY: 100 });
console.log("OK: trajectory hover handled without throwing, trajHover.A =", trajHover.A);
const trajTipA = trajTooltips["A"];
if (!trajTipA || trajTipA.hidden) throw new Error("hovering a trajectory line did not show a tooltip");
const varyKeyForTest = axisKey(currentExperiment(), otherAxis(app.trajFixAxis));
const expectedDisplay = fmtAxis(varyKeyForTest, trajHover.A);
if (!trajTipA.innerHTML.includes(expectedDisplay)) throw new Error("trajectory tooltip does not show the hovered line's varying-axis value, display-shifted (" + expectedDisplay + " for raw " + trajHover.A + "): " + trajTipA.innerHTML);
// this experiment (index 14, n=15) has both axes as dampening keys, so this is also a
// direct regression check that the -1 shift is actually applied, not just present in some form
if (varyKeyForTest === "aiDampeningBelow" || varyKeyForTest === "aiDampeningAbove") {
  if (expectedDisplay === fmtNum(trajHover.A)) throw new Error("dampening value was not display-shifted at all: " + expectedDisplay);
  console.log("OK: confirmed display-shifted (raw " + trajHover.A + " -> shown as " + expectedDisplay + ")");
}
console.log("OK: trajectory tooltip shows the non-held value:", trajTipA.innerHTML.replace(/\s+/g, " "));
trajA.dispatch("mouseleave", {});
if (!trajTipA.hidden) throw new Error("mouseleave did not hide the trajectory tooltip");

console.log("--- switching experiments while in trajectories view (regression check: stale trajValueA/B) ---");
app.expIndex = 3; // experiment.4: turnoverRate x aiDampeningBelow — very different axis ranges than exp 15
onExperimentChange();
const exp4 = currentExperiment();
const aOk = exp4.xValues.some((v) => Math.abs(v - app.trajValueA) < 1e-9) || exp4.yValues.some((v) => Math.abs(v - app.trajValueA) < 1e-9);
if (!aOk) throw new Error("after switching experiments, trajValueA (" + app.trajValueA + ") is not a valid value on either axis of the new experiment");
console.log("OK: trajValueA re-derived correctly for the new experiment:", app.trajValueA);

console.log("--- metric switch while in trajectories view ---");
const metricSelect2 = document.getElementById("metricSelect");
metricSelect2.value = DATA.metrics[2].key;
metricSelect2.dispatch("change", { target: metricSelect2 });
console.log("OK: metric switched to", app.metricKey, "in trajectories view without throwing");

console.log("--- back to heatmap view ---");
document.getElementById("tabHeatmap").dispatch("click");
if (app.viewMode !== "heatmap") throw new Error("tab click did not switch back to heatmap");
if (document.getElementById("tickField").style.display !== "flex") throw new Error("tick field should be visible again in heatmap view");

console.log("\\nALL REPORT FLOWS COMPLETED WITHOUT THROWING");
`;

const sandbox = {
  document, window, MutationObserver, getComputedStyle,
  console, Math, Set, Array, Object, JSON, parseInt, parseFloat, isFinite,
};
vm.createContext(sandbox);
try {
  vm.runInContext(scriptMatch[1] + "\n" + driver, sandbox, { filename: "report+driver.js" });
} catch (err) {
  console.error("\nTHREW:", err.stack || err);
  process.exitCode = 1;
}
