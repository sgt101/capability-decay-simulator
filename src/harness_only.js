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


module.exports = { document, window, MutationObserver, getComputedStyle, FakeFileReader: null };
