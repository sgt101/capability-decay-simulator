"use strict";
const assert = require("node:assert/strict");
const { initSim, tick, institutionStats, EXPERT_THRESHOLD, MONTHLY_TICK_PARAMS, PIPELINE_PARAMS } = require("../engine.js");
const { MovementRecorder, aggregateRoutes, groupInstitutions, focusMembers, movementTotals, snapshotAt } = require("../network_view.js");

// Recording must leave both model state and the next random draw identical.
for (const aiEnabled of [false, true]) {
  const params = { ...MONTHLY_TICK_PARAMS, ...PIPELINE_PARAMS, N: 120, M: 6, graphAttachment: 2, seed: 2026, aiEnabled, baseMoveProb: 0.15, turnoverRate: 0.08 };
  const plain = initSim(params), observed = initSim(params);
  const recorder = new MovementRecorder(EXPERT_THRESHOLD);
  for (let t = 1; t <= 180; t++) {
    const entry = tick(plain);
    tick(observed, recorder.observe); recorder.finish(t);
    assert.deepEqual(observed.history[t - 1], entry);
    const routes = recorder.window(t, 1).routes;
    assert.equal(routes.reduce((s, r) => s + r.moves, 0), entry.moves);
    assert.equal(routes.reduce((s, r) => s + r.upgrades, 0), entry.upgradingArrivals);
  }
  for (const key of ["E", "inst", "L", "active", "tenure", "aptitude", "origin", "sinceMove"]) assert.deepEqual(observed[key], plain[key], key);
  assert.equal(observed.rng(), plain.rng(), "observer consumed or reordered random draws");
}
console.log("ok: recording preserves AI/no-AI trajectories, histories and random state");

// Independently reconstruct actual moves from slots, with retirement disabled.
{
  const s = initSim({ N: 90, M: 6, graphAttachment: 2, seed: 91, baseMoveProb: 0.8, turnoverRate: 0 });
  for (let i = 0; i < s.N; i++) s.E[i] = (i + 1) / (s.N + 1);
  for (let t = 0; t < 12; t++) {
    const old = s.inst.slice(), teachers = institutionStats(s).Teach.slice(), actual = [];
    tick(s, (from, to, expertise, upgrades) => actual.push([from, to, expertise, upgrades]));
    const expected = [];
    for (let i = 0; i < s.N; i++) if (old[i] !== s.inst[i]) expected.push([old[i], s.inst[i], s.E[i], s.E[i] > teachers[s.inst[i]]]);
    assert.deepEqual(actual, expected, "callback must describe post-learning moves against the pre-move teaching level");
    assert.equal(actual.reduce((v, e) => v + e[2], 0), s.history[t].moveExpertiseFlux);
  }
}
console.log("ok: recorded origins, destinations, expertise and teaching comparisons match actual movers");

{
  const s = initSim({ N: 100, M: 5, seed: 44, baseMoveProb: 0, turnoverRate: 1 });
  let calls = 0;
  const h = tick(s, () => calls++);
  assert.ok(h.turnover > 0);
  assert.equal(calls, 0, "retirement/recruitment must not count as movement");
  s.active.fill(0); s.activeCount = 0;
  tick(s, () => calls++);
  assert.equal(calls, 0, "vacant slots must not move");
}
console.log("ok: recruitment, retirement, vacancies and staying put produce no movement records");

{
  const r = new MovementRecorder(EXPERT_THRESHOLD, 3, 10);
  r.observe(0, 1, EXPERT_THRESHOLD, true);
  r.observe(0, 1, EXPERT_THRESHOLD - 0.01, false);
  r.observe(0, 0, 1, true);
  r.finish(1);
  assert.deepEqual(r.window(1, 12).routes, [{ from: 0, to: 1, moves: 2, experts: 1, upgrades: 1 }]);
  r.observe(1, 0, 1, false); r.finish(2);
  r.observe(0, 2, 1, true); // The uncommitted month must not leak into history.
  assert.equal(r.window(2, 1).routes.length, 1);
  assert.equal(r.window(1, 1).routes[0].moves, 2);
  r.finish(3); r.finish(4);
  assert.equal(r.months.length, 3);
  assert.equal(r.window(4, 3).available, true);
  assert.equal(r.window(4, 4).available, false);
  assert.equal(r.window(1, 1).available, false);
  assert.equal(r.window(5, 1).available, false);
  assert.deepEqual(r.window(0, 12).routes, []);
  assert.throws(() => r.finish(6), /consecutive/);
  const small = new MovementRecorder(EXPERT_THRESHOLD, 100, 2);
  small.observe(0, 1, 1, true); small.finish(1);
  small.observe(0, 2, 1, true); small.observe(0, 3, 1, true); small.finish(2);
  assert.equal(small.routeCount, 2);
  assert.equal(small.window(2, 1).routes.length, 2);
  assert.equal(small.window(2, 2).available, false);
  small.observe(1, 2, 1, true); small.observe(1, 3, 1, true); small.observe(1, 4, 1, true); small.finish(3);
  assert.equal(small.routeCount, 0);
  assert.equal(small.window(3, 1).available, false, "oversized month must never produce partial totals");
}
console.log("ok: exact window boundaries, early runs, expert threshold and bounded history");

{
  const institutions = [
    { hubCities: ["London"], sector: "Finance" },
    { hubCities: ["London", "New York"], sector: "Finance" },
    { hubCities: ["New York"], sector: "Research" },
    { hubCities: ["London"], sector: "Research" },
  ];
  for (const mode of ["compact", "hubs", "sectors", "institutions"]) {
    const g = groupInstitutions(institutions, 4, mode);
    assert.deepEqual(g.groups.flatMap(x => x.members).sort(), [0, 1, 2, 3], "institutions must appear exactly once");
    assert.ok(g.layout.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
  const g = groupInstitutions(institutions, 4, "hubs");
  assert.equal(g.groups[g.membership[1]].type, "shared");
  assert.deepEqual(g.affiliations.filter(a => a.institution === 1).map(a => g.groups[a.hub].label).sort(), ["London", "New York"]);
  const ny = g.groups.findIndex(x => x.label === "New York");
  assert.deepEqual(focusMembers(g, "g" + ny), [1, 2], "hub selection must include its shared institution");
  const routes = [{ from: 0, to: 3, moves: 2, experts: 1 }, { from: 0, to: 2, moves: 3, experts: 2 }, { from: 2, to: 0, moves: 4, experts: 3 }];
  const agg = aggregateRoutes(routes, j => "g" + g.membership[j], "moves");
  assert.equal(agg.internal.get("g" + g.membership[0]), 2);
  assert.deepEqual(agg.edges.map(x => x.value), [4, 3], "opposite directions must remain separate");
  assert.equal(agg.edges.reduce((s, e) => s + e.value, 0) + [...agg.internal.values()].reduce((s, v) => s + v, 0), 9);
  const plain = groupInstitutions(null, 5, "compact");
  assert.equal(plain.grouped, false); assert.equal(plain.groups.length, 5);
  const sim = { networkStart: { t: 0 }, snapshots: [{ t: 50 }, { t: 51 }] };
  assert.equal(snapshotAt(sim, 0).t, 0);
  assert.equal(snapshotAt(sim, 49), null);
  assert.equal(snapshotAt(sim, 51).t, 51);
  assert.equal(snapshotAt(sim, 52), null);
}
console.log("ok: grouping avoids double counting, preserves directions and distinguishes missing history");

// This fixture catches the New York omission and inflated movement totals from
// treating an organisation's several affiliations as separate institutions.
{
  const institutions = [
    { label: "Shared A", hubCities: ["London", "New York"], sector: "Finance" },
    { label: "Shared B", hubCities: ["London", "New York"], sector: "Finance" },
    { label: "NY only", hubCities: ["New York"], sector: "Research" },
    { label: "London only", hubCities: ["London"], sector: "Research" },
    { label: "Small shared", hubCities: ["Small A", "Small B"], sector: "Research" },
  ];
  const g = groupInstitutions(institutions, institutions.length, "hubs");
  const members = focusMembers(g, "g" + g.groups.findIndex(x => x.label === "New York"));
  const routes = [{ from: 0, to: 1, moves: 5 }, { from: 3, to: 0, moves: 2 }, { from: 2, to: 4, moves: 3 }];
  assert.deepEqual(movementTotals(routes, members, "moves"), { incoming: 2, outgoing: 3, internal: 5 });
  const compact = groupInstitutions(institutions, institutions.length, "compact");
  assert.equal(compact.affiliations.filter(a => a.institution === 4).length, 1, "collapsed small cities must not duplicate an affiliation link");
  assert.equal(new Set(compact.groups[0].affiliates).size, compact.groups[0].affiliates.length);
  assert.deepEqual(groupInstitutions(institutions, institutions.length, "hubs").layout, g.layout, "layout must be deterministic");
}
{
  const fs = require("node:fs"), paths = require("../paths.js");
  const { loadWorldModel } = require("../world_model.js");
  const world = loadWorldModel(JSON.parse(fs.readFileSync(paths.data("world-model.json"))), JSON.parse(fs.readFileSync(paths.data("mobility-costs.json"))));
  for (const mode of ["compact", "hubs"]) {
    const g = groupInstitutions(world.institutions, world.M, mode);
    const ny = g.groups.findIndex(x => x.label === "New York");
    const expected = world.institutions.flatMap((x, j) => x.hubCities.includes("New York") ? [j] : []);
    assert.deepEqual(focusMembers(g, "g" + ny), expected);
    assert.ok(expected.length > g.groups[ny].members.length, "fixture must include shared New York affiliations");
    assert.deepEqual(g.groups.flatMap(x => x.members).sort((a, b) => a - b), Array.from({ length: world.M }, (_, j) => j));
    for (const j of expected) if (world.institutions[j].hubCities.length > 1) {
      assert.ok(g.affiliations.some(a => a.institution === j && a.hub === ny), world.institutions[j].label + " missing its New York link");
    }
  }
}
console.log("ok: shared hub affiliations remain visible, selectable and counted once per movement selection");
console.log("ALL MOVEMENT RECORDING CHECKS PASSED");
