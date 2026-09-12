/* Network presentation and bounded movement recording. No model rules live here. */
(function (root) {
"use strict";

class MovementRecorder {
  constructor(expertThreshold, maxMonths = 4060, maxRoutes = 200000) {
    this.expertThreshold = expertThreshold;
    this.maxMonths = maxMonths;
    this.maxRoutes = maxRoutes;
    this.months = [];
    this.routeCount = 0;
    this.endTick = 0;
    this.pending = new Map();
    this.observe = (from, to, expertise, upgrades) => {
      if (from === to) return;
      const key = from + ":" + to;
      let r = this.pending.get(key);
      if (!r) { r = { from, to, moves: 0, experts: 0, upgrades: 0 }; this.pending.set(key, r); }
      r.moves++;
      if (expertise >= this.expertThreshold) r.experts++;
      if (upgrades) r.upgrades++;
    };
  }
  finish(tick) {
    if (tick !== this.endTick + 1) throw new Error("Movement recording requires consecutive ticks");
    const routes = Array.from(this.pending.values());
    this.pending.clear();
    this.months.push({ tick, routes });
    this.endTick = tick;
    this.routeCount += routes.length;
    // Evict whole months, never part of a month. An oversized single month is also
    // evicted, leaving an explicit unavailable window instead of partial totals.
    while (this.months.length > this.maxMonths || this.routeCount > this.maxRoutes) {
      this.routeCount -= this.months.shift().routes.length;
    }
  }
  window(end, duration) {
    const start = Math.max(0, end - duration);
    const first = this.months.length ? this.months[0].tick : this.endTick + 1;
    const available = end <= this.endTick && (end === 0 || start >= first - 1);
    if (!available) return { available: false, start, end, first, routes: [] };
    const merged = new Map();
    for (const month of this.months) {
      if (month.tick <= start) continue;
      if (month.tick > end) break;
      for (const r of month.routes) {
        const key = r.from + ":" + r.to;
        let sum = merged.get(key);
        if (!sum) { sum = { from: r.from, to: r.to, moves: 0, experts: 0, upgrades: 0 }; merged.set(key, sum); }
        sum.moves += r.moves; sum.experts += r.experts; sum.upgrades += r.upgrades;
      }
    }
    return { available: true, start, end, first, routes: Array.from(merged.values()) };
  }
}

function groupInstitutions(institutions, M, mode) {
  const grouped = !!institutions && mode !== "institutions";
  const hubView = grouped && mode !== "sectors";
  const groups = [], byKey = new Map(), membership = new Int32Array(M), layout = Array(M);
  const cities = Array.from({ length: M }, (_, j) => [...new Set(institutions && institutions[j].hubCities || [])]);
  const add = (key, label, type = "group") => {
    if (!byKey.has(key)) {
      byKey.set(key, groups.length);
      groups.push({ key, label, type, members: [], affiliates: [], cities: [] });
    }
    return byKey.get(key);
  };
  const hubForCity = new Map();
  if (hubView) {
    const counts = new Map();
    cities.forEach(cs => cs.forEach(c => counts.set(c, (counts.get(c) || 0) + 1)));
    // Count every affiliation when choosing major hubs, including shared institutions.
    for (const [city, count] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      const small = mode === "compact" && count < 5;
      const gi = add(small ? "small" : "hub:" + city, small ? "Smaller hubs" : city, "hub");
      hubForCity.set(city, gi); groups[gi].cities.push(city);
    }
  }
  const affiliations = [];
  for (let j = 0; j < M; j++) {
    const x = institutions && institutions[j], cs = cities[j];
    let gi;
    if (hubView) {
      const hubs = [...new Set(cs.map(c => hubForCity.get(c)))];
      hubs.forEach(h => groups[h].affiliates.push(j));
      if (cs.length > 1) {
        gi = add("i:" + j, x.label || "Institution " + j, "shared");
        // An organisation has one node, even when several cities collapse into
        // Smaller hubs. Its affiliation links never stand for staff or moves.
        hubs.forEach(hub => affiliations.push({ institution: j, hub }));
      } else if (cs.length) gi = hubs[0];
      else gi = add("unknown", "Unspecified hub");
    } else if (grouped) gi = add("sector:" + (x.sector || "Unspecified sector"), x.sector || "Unspecified sector");
    else gi = add("i:" + j, "Institution " + j);
    membership[j] = gi; groups[gi].members.push(j);
  }
  const anchors = groups.filter(g => g.type !== "shared");
  const shared = groups.filter(g => g.type === "shared");
  // A compact, deterministic central cluster. Recenter the spiral so even a
  // small number of shared institutions sits at the middle of the hub ring.
  shared.forEach((g, n) => {
    const r = 54 * Math.sqrt(n + 0.5), a = n * 2.399963229728653;
    g.x = r * Math.cos(a); g.y = r * Math.sin(a);
  });
  const centreX = shared.reduce((sum, g) => sum + g.x, 0) / (shared.length || 1);
  const centreY = shared.reduce((sum, g) => sum + g.y, 0) / (shared.length || 1);
  shared.forEach(g => { g.x -= centreX; g.y -= centreY; });
  const clusterRadius = Math.max(0, ...shared.map(g => Math.hypot(g.x, g.y)));
  // Leave room for the central nodes, hub outlines and labels. Increase the
  // circumference for large hub counts rather than crowding adjacent hubs.
  const ringRadius = Math.max(260, clusterRadius + 210,
    anchors.length > 1 ? 320 / (2 * Math.sin(Math.PI / anchors.length)) : 0);
  const cols = Math.ceil(Math.sqrt(anchors.length * 1.6));
  const maxAffiliates = Math.max(1, ...anchors.map(g => g.affiliates.length));
  anchors.forEach((g, index) => {
    if (hubView) {
      const a = -Math.PI / 2 + index * 2 * Math.PI / anchors.length;
      g.x = ringRadius * Math.cos(a); g.y = ringRadius * Math.sin(a);
    } else {
      g.x = (index % cols) * 320; g.y = Math.floor(index / cols) * 300;
    }
    g.radius = g.type === "hub" ? Math.max(30, 106 * Math.sqrt(g.affiliates.length / maxAffiliates)) : 104;
    g.members.forEach((j, n) => {
      const r = g.members.length === 1 ? 0 : g.radius * 0.76 * Math.sqrt((n + 0.5) / g.members.length);
      const a = n * 2.399963229728653;
      layout[j] = { x: g.x + r * Math.cos(a), y: g.y + r * Math.sin(a), vx: 0, vy: 0 };
    });
  });
  shared.forEach(g => { layout[g.members[0]] = { x: g.x, y: g.y, vx: 0, vy: 0 }; });
  return { groups, membership, layout, grouped, hubView, affiliations, cities };
}

function focusMembers(grouping, key) {
  if (!key) return null;
  if (key[0] === "i") return [Number(key.slice(1))];
  const g = grouping.groups[Number(key.slice(1))];
  return g.type === "hub" ? g.affiliates : g.members;
}

function movementTotals(routes, members, metric) {
  const ids = new Set(members);
  const totals = { incoming: 0, outgoing: 0, internal: 0 };
  for (const r of routes) {
    if (ids.has(r.from) && ids.has(r.to)) totals.internal += r[metric];
    else if (ids.has(r.from)) totals.outgoing += r[metric];
    else if (ids.has(r.to)) totals.incoming += r[metric];
  }
  return totals;
}

function aggregateRoutes(routes, entityFor, metric) {
  const edges = new Map(), internal = new Map();
  for (const r of routes) {
    const value = r[metric];
    if (!value) continue;
    const from = entityFor(r.from), to = entityFor(r.to);
    if (from === to) { internal.set(from, (internal.get(from) || 0) + value); continue; }
    const key = from + ":" + to;
    const e = edges.get(key) || { from, to, value: 0 };
    e.value += value; edges.set(key, e);
  }
  return { edges: Array.from(edges.values()).sort((a, b) => b.value - a.value || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)), internal };
}

function snapshotAt(sim, tick) {
  if (tick === 0) return sim.networkStart;
  const a = sim.snapshots;
  if (!a.length || tick < a[0].t || tick > a[a.length - 1].t) return null;
  let lo = 0, hi = a.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid].t < tick) lo = mid + 1; else hi = mid; }
  return a[lo].t === tick ? a[lo] : null;
}

const palette = ["#4978bd", "#be7842", "#568664", "#9c6baa", "#bc6474", "#5897a3", "#8a7c46", "#777faa", "#8e746b", "#769344", "#a25a97", "#568c83", "#c48d9e", "#81758f", "#70a4c6", "#bda564", "#6693b7"];
const escape = s => String(s).replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const compact = n => Math.abs(n) >= 1000 ? (n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1) + "k" : (Number.isInteger(n) ? n.toLocaleString() : n.toPrecision(3));
const sizeNames = { count: "people", experts: "experts", capability: "capability" };

function attach(options) {
  const { canvas, getSim, getSnapshot, selectInstitution, theme } = options;
  const el = id => document.getElementById(id);
  const state = { view: "structure", size: "count", grouping: "compact", metric: "moves", months: 12, routeLimit: 15,
    change: "experts", comparison: "start", zoom: 1, panX: 0, panY: 0, expanded: new Set(), focus: null };
  let sim = null, grouping = null, sectors = [], scaleRefs = {}, hit = [], lastScene = null, drag = null, hover = null, drawKey = null;
  const name = j => sim.graph.institutions ? sim.graph.institutions[j].label : "Institution " + j;
  const sector = j => sim.graph.institutions ? sim.graph.institutions[j].sector || "Unspecified" : "Institutions";
  const sectorColor = s => palette[Math.max(0, sectors.indexOf(s)) % palette.length];
  function regroup() {
    grouping = groupInstitutions(sim.graph.institutions, sim.M, state.grouping);
    state.expanded.clear(); state.focus = null; state.zoom = 1; state.panX = state.panY = 0;
    let html = '<option value="">All institutions</option>';
    if (grouping.grouped) grouping.groups.forEach((g, i) => {
      if (g.type === "shared") return;
      html += '<option value="g' + i + '">' + escape(g.label) + ' · ' + (g.type === "hub" ? g.affiliates.length + ' affiliated institutions' : g.members.length + ' institutions') + '</option>';
    });
    for (let j = 0; j < sim.M; j++) html += '<option value="i' + j + '">' + escape(name(j)) + '</option>';
    el("networkFocus").innerHTML = html;
    el("networkFocus").value = "";
    scaleRefs = {};
    for (const key of ["count", "experts", "capability"]) {
      const values = sim.networkStart[key];
      scaleRefs[key] = { institution: Math.max(1, ...values), group: Math.max(1, ...grouping.groups.filter(g => g.type !== "shared").map(g => g.members.reduce((s, j) => s + values[j], 0))) };
    }
  }
  function sync() {
    if (sim === getSim()) return;
    sim = getSim(); if (!sim) return;
    sectors = [...new Set(Array.from({ length: sim.M }, (_, j) => sector(j)))].sort();
    regroup(); drawKey = null;
  }
  function centreOn(pos) {
    if (!canvas._hit) return;
    const r = canvas.getBoundingClientRect(), x = canvas._hit.px(pos.x), y = canvas._hit.py(pos.y);
    const next = Math.max(state.zoom, 3.5), ratio = next / state.zoom;
    state.panX = (state.panX - (x - r.width / 2)) * ratio;
    state.panY = (state.panY - (y - r.height / 2)) * ratio;
    state.zoom = next;
  }
  function focus(key) {
    state.focus = key || null;
    if (key && key[0] === "i") {
      const j = Number(key.slice(1));
      state.expanded.add(grouping.membership[j]);
      centreOn(grouping.layout[j]);
      selectInstitution(j);
    } else selectInstitution(null);
    el("networkFocus").value = key || "";
  }
  function controls() {
    el("networkMovementControls").hidden = state.view !== "movement";
    el("networkChangeControls").hidden = state.view !== "change";
    el("networkGroup").disabled = !sim.graph.institutions;
    el("networkExpand").disabled = !grouping.grouped;
    el("networkCollapse").disabled = !grouping.grouped;
  }
  const settings = [["networkView", "view"], ["networkSize", "size"], ["networkGroup", "grouping"],
    ["networkMoveMetric", "metric"], ["networkWindow", "months"], ["networkRouteLimit", "routeLimit"], ["networkChangeMetric", "change"], ["networkComparison", "comparison"]];
  settings.forEach(([id, key]) => el(id).addEventListener("change", e => {
    state[key] = (key === "months" || key === "routeLimit") ? Number(e.target.value) : e.target.value;
    if (key === "grouping") { regroup(); selectInstitution(null); }
    draw();
  }));
  el("networkFocus").addEventListener("change", e => { focus(e.target.value); draw(); });
  el("networkExpand").addEventListener("click", () => {
    if (state.focus && state.focus[0] === "g") {
      const gi = Number(state.focus.slice(1)); state.expanded.add(gi); centreOn(grouping.groups[gi]);
    }
    else grouping.groups.forEach((g, i) => state.expanded.add(i));
    draw();
  });
  el("networkCollapse").addEventListener("click", () => {
    if (state.focus && state.focus[0] === "g") state.expanded.delete(Number(state.focus.slice(1)));
    else if (state.focus && state.focus[0] === "i") {
      const gi = grouping.membership[Number(state.focus.slice(1))];
      if (grouping.groups[gi].type !== "shared") { state.expanded.delete(gi); focus("g" + gi); }
    }
    else state.expanded.clear();
    draw();
  });
  el("networkFit").addEventListener("click", () => { state.zoom = 1; state.panX = state.panY = 0; draw(); });
  function zoom(factor, x, y) {
    const rect = canvas.getBoundingClientRect(), old = state.zoom;
    state.zoom = Math.max(0.5, Math.min(8, state.zoom * factor));
    const k = state.zoom / old;
    state.panX = x - rect.width / 2 - (x - rect.width / 2 - state.panX) * k;
    state.panY = y - rect.height / 2 - (y - rect.height / 2 - state.panY) * k;
    draw();
  }
  el("networkZoomIn").addEventListener("click", () => { const r = canvas.getBoundingClientRect(); zoom(1.3, r.width / 2, r.height / 2); });
  el("networkZoomOut").addEventListener("click", () => { const r = canvas.getBoundingClientRect(); zoom(1 / 1.3, r.width / 2, r.height / 2); });
  canvas.addEventListener("wheel", e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  const point = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function at(p) {
    // Nodes before cloud backgrounds; nearest node wins when click targets overlap.
    let best = null, distance = Infinity;
    for (const n of hit) {
      const d = Math.hypot(p.x - n.x, p.y - n.y);
      if (d <= Math.max(n.r, 5) + 2 && d < distance) { best = n; distance = d; }
    }
    return best;
  }
  canvas.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", e => {
    if (drag) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
      if (drag.moved) { state.panX = drag.px + e.clientX - drag.x; state.panY = drag.py + e.clientY - drag.y; draw(); }
      return;
    }
    const found = at(point(e)); hover = found ? found.key : null;
    canvas.title = found ? found.tooltip : "Drag to pan · scroll to zoom · double-click a hub to expand";
  });
  canvas.addEventListener("pointerup", e => {
    if (drag && !drag.moved) { const n = at(point(e)); focus(n ? n.key : null); draw(); }
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointercancel", () => { drag = null; });
  canvas.addEventListener("dblclick", e => {
    const n = at(point(e));
    if (n && n.key[0] === "g") { const gi = Number(n.key.slice(1)); if (state.expanded.has(gi)) state.expanded.delete(gi); else { state.expanded.add(gi); centreOn(grouping.groups[gi]); } draw(); }
  });
  function draw() {
    sync(); if (!sim) return; controls();
    const snap = getSnapshot(); if (!snap) return;
    const rect = canvas.getBoundingClientRect(), w = Math.max(10, rect.width), h = Math.max(10, rect.height);
    const dpr = window.devicePixelRatio || 1;
    const signature = [snap.t, w, h, dpr, theme(), state.view, state.size, state.grouping, state.metric, state.months, state.routeLimit,
      state.change, state.comparison, state.zoom, state.panX, state.panY, state.focus, [...state.expanded].join(","), hover].join("|");
    if (signature === drawKey) return;
    drawKey = signature;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const dark = theme() === "dark", ink = dark ? "#e3e9f0" : "#24354a", muted = dark ? "#aab7c7" : "#536476";
    const xs = grouping.groups.map(g => g.x), ys = grouping.groups.map(g => g.y);
    const minX = Math.min(0, ...xs), minY = Math.min(0, ...ys);
    const maxX = Math.max(0, ...xs), maxY = Math.max(0, ...ys);
    // Hub captions use screen pixels, so reserve screen space as well as the
    // world-space outlines when fitting the ring (especially its top hub).
    const baseScale = grouping.hubView
      ? Math.min((w - 110) / (maxX - minX + 212), (h - 100) / (maxY - minY + 212))
      : Math.min((w - 32) / (maxX - minX + 350), (h - 32) / (maxY - minY + 270));
    const s = Math.max(0.01, baseScale) * state.zoom;
    const px = x => w / 2 + (x - (maxX + minX) / 2) * s + state.panX;
    const py = y => h / 2 + (y - (maxY + minY) / 2) * s + state.panY;
    const entityFor = j => grouping.grouped && grouping.groups[grouping.membership[j]].type !== "shared" && !state.expanded.has(grouping.membership[j]) ? "g" + grouping.membership[j] : "i" + j;
    const selected = state.focus, members = focusMembers(grouping, selected), selectedIds = members && new Set(members);
    const touches = n => !selected || n.key === selected || n.members.some(j => selectedIds.has(j));
    const entities = new Map();
    for (let j = 0; j < sim.M; j++) {
      const key = entityFor(j);
      if (!entities.has(key)) entities.set(key, { key, members: [], value: 0, count: 0, experts: 0, mix: new Map(), change: 0 });
      const n = entities.get(key); n.members.push(j); n.value += snap[state.size][j]; n.count += snap.count[j]; n.experts += snap.experts[j];
      n.mix.set(sector(j), (n.mix.get(sector(j)) || 0) + snap.count[j]);
    }
    const comparisonTick = state.comparison === "start" ? 0 : Math.max(0, snap.t - 12);
    const before = snapshotAt(sim, comparisonTick);
    let maxChange = 1;
    for (const n of entities.values()) {
      const isGroup = n.key[0] === "g", index = Number(n.key.slice(1));
      const pos = isGroup ? grouping.groups[index] : grouping.layout[index];
      n.x = px(pos.x); n.y = py(pos.y);
      // Fixed start-of-run references, separate for summary nodes and institutions.
      const ref = scaleRefs[state.size][isGroup ? "group" : "institution"];
      const referenceRadius = isGroup ? Math.min(38, baseScale * (grouping.hubView ? 45 : 90)) : Math.min(19, baseScale * (grouping.hubView ? 30 : 46));
      n.r = Math.max(2, referenceRadius * Math.sqrt(Math.max(0, n.value) / ref) * Math.min(1, Math.sqrt(state.zoom)));
      n.label = isGroup ? (grouping.groups[index].type === "hub" ? n.members.length + " single-hub" : grouping.groups[index].label) : name(index);
      if (before) n.change = n.members.reduce((sum, j) => sum + snap[state.change][j] - before[state.change][j], 0);
      maxChange = Math.max(maxChange, Math.abs(n.change));
      n.tooltip = n.label + " · " + n.count + " people · " + n.experts + " experts" + (isGroup ? " · " + n.members.length + " institutions" : "") + " · " + compact(n.value) + " " + sizeNames[state.size];
      if (isGroup && grouping.groups[index].type === "hub") n.tooltip = grouping.groups[index].label + " · " + n.tooltip;
      if (!isGroup && grouping.cities[index].length > 1) n.tooltip += " · affiliated hubs: " + grouping.cities[index].join(", ");
      if (state.view === "change" && before) n.tooltip += " · change " + (n.change > 0 ? "+" : "") + compact(n.change);
    }
    // Hub outlines include every affiliation, including the shared nodes outside
    // the cloud. Population summaries inside contain only single-hub institutions.
    if (grouping.grouped) grouping.groups.forEach((g, i) => {
      if (g.type === "shared" || (g.type !== "hub" && !state.expanded.has(i))) return;
      ctx.beginPath(); ctx.arc(px(g.x), py(g.y), g.radius * s, 0, Math.PI * 2);
      ctx.fillStyle = dark ? "#ffffff09" : "#31587709"; ctx.fill();
      ctx.strokeStyle = selected === "g" + i ? ink : dark ? "#ffffff35" : "#31587750"; ctx.lineWidth = selected === "g" + i ? 2 : 1; ctx.stroke();
      ctx.fillStyle = muted; ctx.font = "11px system-ui"; ctx.textAlign = "center";
      let hubLabel = g.label, labelEnd = hubLabel.length;
      while (labelEnd > 4 && ctx.measureText(hubLabel).width > Math.max(55, 300 * s)) { labelEnd--; hubLabel = g.label.slice(0, labelEnd) + "\u2026"; }
      ctx.fillText(hubLabel, px(g.x), py(g.y - g.radius) - (g.type === "hub" ? 19 : 5));
      if (g.type === "hub") {
        ctx.font = "10px system-ui";
        ctx.fillText(g.affiliates.length + " affiliated", px(g.x), py(g.y - g.radius) - 6);
      }
    });
    const affiliationLinks = grouping.affiliations.filter(a => {
      if (state.view !== "structure" && !selected) return false;
      return !selected || (selected[0] === "g" ? selected === "g" + a.hub : selectedIds.has(a.institution));
    });
    ctx.setLineDash([4, 4]);
    for (const a of affiliationLinks) {
      const n = entities.get("i" + a.institution), g = grouping.groups[a.hub];
      ctx.globalAlpha = selected && state.view === "structure" ? 0.5 : 0.12;
      ctx.strokeStyle = sectorColor(sector(a.institution)); ctx.lineWidth = selected ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(px(g.x), py(g.y)); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    let windowData = null, flow = { edges: [], internal: new Map() }, shown = [], detail = "";
    if (state.view === "movement") {
      windowData = sim.movement.window(snap.t, state.months);
      flow = aggregateRoutes(windowData.routes, entityFor, state.metric);
      shown = flow.edges.filter(e => !selected || touches(entities.get(e.from)) || touches(entities.get(e.to)));
      const totalRoutes = shown.length;
      if (state.routeLimit) shown = shown.slice(0, state.routeLimit);
      const maxFlow = Math.max(1, ...flow.edges.map(e => e.value));
      for (const e of shown) {
        const a = entities.get(e.from), b = entities.get(e.to);
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy); if (d < a.r + b.r + 10) continue;
        const ux = dx / d, uy = dy / d;
        const x1 = a.x + ux * (a.r + 3), y1 = a.y + uy * (a.r + 3);
        const x2 = b.x - ux * (b.r + 5), y2 = b.y - uy * (b.r + 5);
        const bend = Math.min(28, d * 0.13), cx = (x1 + x2) / 2 - uy * bend, cy = (y1 + y2) / 2 + ux * bend;
        ctx.strokeStyle = dark ? "#7ebfd9" : "#397f9b"; ctx.fillStyle = ctx.strokeStyle;
        ctx.globalAlpha = 0.7; ctx.lineWidth = 0.7 + 5 * e.value / maxFlow;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke();
        const angle = Math.atan2(y2 - cy, x2 - cx), arrow = 5 + ctx.lineWidth;
        ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - arrow * Math.cos(angle - 0.45), y2 - arrow * Math.sin(angle - 0.45)); ctx.lineTo(x2 - arrow * Math.cos(angle + 0.45), y2 - arrow * Math.sin(angle + 0.45)); ctx.closePath(); ctx.fill();
        if (shown.length <= 15 || state.zoom >= 6) { ctx.globalAlpha = 1; ctx.font = "11px system-ui"; ctx.textAlign = "center"; ctx.fillStyle = ink; ctx.fillText(String(e.value), (x1 + 2 * cx + x2) / 4, (y1 + 2 * cy + y2) / 4 - 4); }
      }
      ctx.globalAlpha = 1;
      detail = !windowData.available ? "Movement history unavailable for this window; choose a later date or shorter window."
        : !flow.edges.length && !flow.internal.size ? "No moves in this window."
        : "Showing " + shown.length + " of " + totalRoutes + " routes" + (selected ? " touching the selection." : ".") + (shown.length < totalRoutes ? " Strongest routes shown; choose All to see the rest. Totals include every route." : "");
      if (windowData.available && flow.edges.length) detail += " Arrow width reference = " + maxFlow + " moves in this window.";
      if (members && windowData.available) {
        const { incoming, outgoing, internal } = movementTotals(windowData.routes, members, state.metric);
        detail = "Selection: " + incoming + " incoming · " + outgoing + " outgoing · " + internal + " between selected institutions. " + detail;
      }
    } else if (state.view === "structure") {
      const links = new Set();
      for (let i = 0; i < sim.M; i++) for (const j of sim.graph.neighbors[i]) {
        const ka = entityFor(i), kb = entityFor(j); if (ka === kb) continue;
        const k = [ka, kb].sort().join(":"); if (links.has(k)) continue; links.add(k);
        const a = entities.get(ka), b = entities.get(kb);
        if (selected && !touches(a) && !touches(b)) continue;
        // City selections emphasize affiliation links. Institution selections also
        // expose their actual graph neighbours; those links are solid.
        if (grouping.hubView && (!selected || selected[0] === "g")) continue;
        ctx.strokeStyle = muted; ctx.globalAlpha = selected ? 0.22 : 0.055; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const largest = new Set([...entities.values()].sort((a, b) => b.value - a.value).slice(0, 5).map(n => n.key));
    hit = [];
    for (const n of entities.values()) {
      if (n.x + n.r < 0 || n.x - n.r > w || n.y + n.r < 0 || n.y - n.r > h) continue;
      const highlighted = touches(n), isGroup = n.key[0] === "g";
      n.highlighted = !!selected && highlighted;
      ctx.globalAlpha = selected && !highlighted ? 0.35 : 1;
      if (state.view === "change") {
        const f = before ? Math.min(1, Math.abs(n.change) / maxChange) : 0;
        ctx.fillStyle = !before || n.change === 0 ? (dark ? "#8793a1" : "#b5bfc9") : n.change > 0 ? "hsl(177, " + (30 + 35 * f) + "%, " + (65 - 30 * f) + "%)" : "hsl(22, " + (35 + 45 * f) + "%, " + (75 - 25 * f) + "%)";
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      } else {
        let angle = -Math.PI / 2;
        const mix = n.count ? n.mix : new Map([[sector(n.members[0]), 1]]);
        for (const [label, value] of mix) {
          if (!value) continue;
          const end = angle + Math.PI * 2 * value / (n.count || 1);
          ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.arc(n.x, n.y, n.r, angle, end); ctx.closePath(); ctx.fillStyle = sectorColor(label); ctx.fill(); angle = end;
        }
      }
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.lineWidth = selected && highlighted || hover === n.key ? 2.5 : 1;
      ctx.strokeStyle = selected && highlighted ? ink : dark ? "#101c2b" : "#ffffff"; ctx.stroke();
      if (n.value === 0) { ctx.strokeStyle = muted; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]); }
      ctx.fillStyle = ink; ctx.textAlign = "center"; ctx.font = "11px system-ui";
      if (isGroup || largest.has(n.key) || selected === n.key || hover === n.key || state.zoom >= 6) {
        const labelWidth = Math.max(36, (isGroup ? 300 : 245) * s);
        let label = n.label, remaining = label.length;
        while (remaining > 4 && ctx.measureText(label).width > labelWidth) { remaining--; label = n.label.slice(0, remaining) + "\u2026"; }
        ctx.fillText(label, n.x, n.y + n.r + 14);
        if (isGroup && (!grouping.hubView || state.zoom >= 2 || selected && highlighted)) {
          ctx.fillStyle = muted; ctx.font = "10px system-ui";
          ctx.fillText((grouping.groups[Number(n.key.slice(1))].type === "hub" ? "" : n.members.length + " inst · ") + compact(n.count) + " people", n.x, n.y + n.r + 27);
        }
      }
      ctx.globalAlpha = 1;
      if (state.view === "movement" && flow.internal.has(n.key)) n.tooltip += " · " + flow.internal.get(n.key) + " moves within group";
      hit.push(n);
    }
    // A small centre target lets users select an expanded cloud without swallowing
    // nearby institution clicks. The focus menu also exposes every group and node.
    if (grouping.grouped) grouping.groups.forEach((g, i) => {
      if (g.type === "hub" || state.expanded.has(i) && g.type !== "shared") hit.push({ key: "g" + i, x: px(g.x), y: py(g.y - g.radius) - 12, r: 15, tooltip: g.label + " · " + (g.type === "hub" ? g.affiliates.length + " affiliated institutions, including " + (g.affiliates.length - g.members.length) + " shared" : g.members.length + " institutions") });
    });
    canvas._hit = { layout: grouping.layout, px, py, nodes: hit };
    let legend = "";
    if (state.view === "change") {
      legend = '<span class="network-loss">● Loss</span> · grey: unchanged · <span class="network-gain">● Gain</span> · colour range ±' + compact(maxChange) + ' (this date)';
      if (!before) detail = "Comparison history unavailable; choose a later date or compare with the start.";
      else detail = "Change from month " + comparisonTick + " to " + snap.t + ".";
    } else legend = sectors.map(label => '<span class="network-sector"><i style="background:' + sectorColor(label) + '"></i>' + escape(label) + '</span>').join("");
    el("networkLegend").innerHTML = legend;
    const groupText = grouping.grouped ? "Group summaries use their own size scale; coloured slices show population by sector. " : "";
    const ref = scaleRefs[state.size];
    el("networkScale").textContent = "Area = " + sizeNames[state.size] + " · fixed starting scale: institution reference " + compact(ref.institution) + (grouping.grouped ? "; group reference " + compact(ref.group) : "") + ". Very small/empty nodes have a minimum marker. " + groupText;
    const note = state.grouping === "compact" && grouping.grouped ? "Smaller hubs combines cities with fewer than 5 affiliated institutions. " : "";
    const geography = grouping.hubView ? "Hub outlines show affiliation counts (minimum outline for small hubs). Multi-hub institutions appear once in the center, with hubs arranged around them. Dashed lines = affiliations. Filled group nodes = single-hub institutions only. Hub counts overlap; they are not local staff counts. Arrows = institution changes, not city relocations. " : "";
    if (selected && selected[0] === "g" && grouping.groups[Number(selected.slice(1))].type === "hub") {
      const g = grouping.groups[Number(selected.slice(1))];
      detail = g.label + ": " + g.affiliates.length + " affiliated institutions (" + g.members.length + " single-hub, " + (g.affiliates.length - g.members.length) + " shared). " + detail;
    }
    el("networkStatus").textContent = "Month " + snap.t + (state.view === "movement" && windowData ? " · " + (windowData.end - windowData.start) + " months ending here · arrows count moves, including repeat moves. " : ". ") + detail;
    el("networkHelp").textContent = note + geography + "Click to focus; double-click a group to expand. Drag to pan; scroll to zoom.";
    el("networkSubtitle").textContent = state.view === "structure" ? (grouping.hubView ? "Sector colours · hub affiliations" : "Sector colours · affinity links") : state.view === "movement" ? "Recorded movement" : "Expertise gained and lost";
    lastScene = { tick: snap.t, entities, flow, shown, window: windowData, comparisonTick, comparisonAvailable: !!before, grouping, affiliationLinks, selectedMembers: members };
  }
  return { draw, layout: () => { sync(); return grouping.layout; }, state, focus: key => { sync(); focus(key); draw(); }, scene: () => lastScene };
}
const API = { MovementRecorder, groupInstitutions, aggregateRoutes, focusMembers, movementTotals, snapshotAt, attach };
if (typeof module !== "undefined" && module.exports) module.exports = API;
else root.NetworkView = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
