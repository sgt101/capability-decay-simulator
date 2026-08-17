// Phase C of world-model-plan.md — builds a simulator-ready institution graph
// from world-model.json + mobility-costs.json.
//
// Deliberately fs-free and framework-agnostic: it takes PARSED objects, so the
// same code runs under Node (batch_run.js, tests) and in the browser
// (simulator.html via a file input). Whoever calls it does the reading.
//
//   const wm = loadWorldModel(worldJson, costsJson, opts);
//
// Returns the same shape generateBAGraph() does — { M, neighbors, degree,
// prestige } — so it drops straight into initSim, plus the extra structure the
// affinity model needs.
//
// The central idea (world-model-plan.md section 7): world-model.json is a
// bipartite AFFILIATION network, not a peer graph. There is no transfer graph in
// the data — only the ingredients to compute one. Adjacency here is an OUTPUT.
"use strict";
//
// SCOPE: wrapped in an IIFE so this file publishes EXACTLY ONE name — module.exports
// under Node, globalThis.WorldModel in a browser. simulator.html loads it with
// <script src>, and two classic scripts share ONE global lexical scope: anything
// declared at top level here would collide with an identically-named declaration in
// the page and throw SyntaxError before either script ran. That is precisely what
// broke the page in 2026-08 (seven collisions, starting at the RNG). The body below
// is deliberately NOT re-indented — the wrapper is a scope boundary, not a reason for
// a whitespace diff over every line in the file.
(function () {

const DEFAULT_OPTS = {
  useBlocAffinity: true,
  hubSource: "located_in",   // "located_in" | "scalar"
  prestigeFrom: "intake",    // "intake" | "sizeBand" | "degree" | "weightedDegree"
  zeroIntakePolicy: "floor1",// "floor1" | "drop" | "keep"
  useExplicitEdges: true,
};

const SIZE_BAND_RANK = { Boutique: 1, Mid: 2, Large: 3, Mega: 4 };

// --- small deterministic hash, for provenance (Phase E) --------------------
// FNV-1a over a canonical string. Not cryptographic — it only needs to change
// when the inputs change, so two CSVs generated from different revisions of
// world-model.json are distinguishable.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

function loadWorldModel(world, costs, userOpts) {
  const opts = Object.assign({}, DEFAULT_OPTS, userOpts || {});
  const warnings = [];

  if (!world || !Array.isArray(world.nodes) || !Array.isArray(world.edges)) {
    throw new Error("[world_model] world must be an object with .nodes[] and .edges[]");
  }
  if (!costs || !costs.geoTiers || !costs.sectorTiers) {
    throw new Error("[world_model] costs must supply geoTiers and sectorTiers");
  }

  // ---- index and validate -------------------------------------------------
  const byId = new Map();
  for (const n of world.nodes) {
    if (byId.has(n.node_id)) throw new Error(`[world_model] duplicate node_id: ${n.node_id}`);
    byId.set(n.node_id, n);
  }
  for (const e of world.edges) {
    if (!byId.has(e.source_id)) throw new Error(`[world_model] edge ${e.edge_id} has unknown source_id ${e.source_id}`);
    if (!byId.has(e.target_id)) throw new Error(`[world_model] edge ${e.edge_id} has unknown target_id ${e.target_id}`);
  }

  // ---- geography: hub -> country -> region, and market_index --------------
  const countryOfHub = new Map();
  const regionOfCountry = new Map();
  for (const e of world.edges) {
    if (e.edge_type !== "PART_OF") continue;
    const s = byId.get(e.source_id), t = byId.get(e.target_id);
    if (s.node_type === "Hub" && t.node_type === "Country") countryOfHub.set(s.node_id, t.node_id);
    else if (s.node_type === "Country" && t.node_type === "Region") regionOfCountry.set(s.node_id, t.node_id);
  }

  // A hub's market index is its own override if present, else its country's.
  function marketIndexOfHub(hubId) {
    const hub = byId.get(hubId);
    if (hub && typeof hub.market_index === "number") return hub.market_index;
    const c = countryOfHub.get(hubId);
    const country = c && byId.get(c);
    if (country && typeof country.market_index === "number") return country.market_index;
    return null;
  }

  // ---- institutions = Organisation nodes ----------------------------------
  let orgs = world.nodes.filter((n) => n.node_type === "Organisation");
  if (!orgs.length) throw new Error("[world_model] no Organisation nodes found");

  // hubs per organisation, from LOCATED_IN (set-valued) or the scalar field.
  // Reading the scalar throws away 89 facts in the current dataset — multi-site
  // presence — which is why "located_in" is the default, not an option.
  const hubsOf = new Map();
  for (const e of world.edges) {
    if (e.edge_type !== "LOCATED_IN") continue;
    if (!hubsOf.has(e.source_id)) hubsOf.set(e.source_id, []);
    hubsOf.get(e.source_id).push(e.target_id);
  }

  function hubIdsFor(o) {
    if (opts.hubSource === "scalar") {
      const h = world.nodes.find((n) => n.node_type === "Hub" && n.label === o.hub_city);
      return h ? [h.node_id] : [];
    }
    const list = hubsOf.get(o.node_id) || [];
    if (!list.length && o.hub_city) {
      const h = world.nodes.find((n) => n.node_type === "Hub" && n.label === o.hub_city);
      if (h) return [h.node_id];
    }
    return list;
  }

  // ---- zero-intake policy -------------------------------------------------
  const zeroIntake = orgs.filter((o) => !(o.intake_estimate_central > 0));
  if (zeroIntake.length) {
    if (opts.zeroIntakePolicy === "drop") {
      const drop = new Set(zeroIntake.map((o) => o.node_id));
      orgs = orgs.filter((o) => !drop.has(o.node_id));
      warnings.push(`dropped ${zeroIntake.length} organisation(s) with zero intake: ${zeroIntake.map((o) => o.label).join(", ")}`);
    } else if (opts.zeroIntakePolicy === "floor1") {
      warnings.push(`floored intake to 1 for ${zeroIntake.length} organisation(s): ${zeroIntake.map((o) => o.label).join(", ")}`);
    } else {
      warnings.push(`${zeroIntake.length} organisation(s) have zero intake and will receive no entrants under weighted sizing`);
    }
  }

  const M = orgs.length;
  const idx = new Map(orgs.map((o, i) => [o.node_id, i]));

  // ---- per-institution facts ---------------------------------------------
  const institutions = orgs.map((o, i) => {
    const hubIds = hubIdsFor(o);
    if (!hubIds.length) warnings.push(`organisation has no hub: ${o.label}`);
    const countryIds = [...new Set(hubIds.map((h) => countryOfHub.get(h)).filter(Boolean))];
    const blocs = [...new Set(countryIds.map((c) => byId.get(c).bloc).filter(Boolean))];
    if (countryIds.length && !blocs.length) warnings.push(`country has no bloc: ${o.country} (${o.label})`);

    const mi = hubIds.map(marketIndexOfHub).filter((v) => v != null);
    if (!mi.length) warnings.push(`no market_index resolvable for: ${o.label} (${o.hub_city})`);

    const rawIntake = o.intake_estimate_central > 0 ? o.intake_estimate_central
      : (opts.zeroIntakePolicy === "floor1" ? 1 : 0);

    return {
      index: i,
      node_id: o.node_id,
      label: o.label,
      // Human-readable location, for anything that needs to show WHICH institution a
      // node is rather than an index. hubIds are node ids; these are the city names
      // behind them, with the organisation's own hub_city as the fallback for an org
      // that has no LOCATED_IN edge.
      hubCities: (() => {
        const names = hubIds.map((id) => { const h = byId.get(id); return h && h.label; }).filter(Boolean);
        return names.length ? names : (o.hub_city ? [o.hub_city] : []);
      })(),
      country: o.country || null,
      sector: o.sector,
      sector_id: null,             // filled below
      subsector: o.subsector_tier,
      hubIds,
      countryIds,
      blocs,
      // An organisation present in several cities is represented by its BEST
      // market index — a person at global-bank-X is treated as having access to
      // that firm's strongest market, which is what makes intra-firm relocation
      // the cheap path it is in reality.
      marketIndex: mi.length ? Math.max.apply(null, mi) : null,
      intake: rawIntake,
      sizeBand: o.org_size_band,
    };
  });

  // sector_id: map the org's sector LABEL back to a Sector node id, so
  // sectorFamilies can be keyed by id rather than by a renameable label.
  const sectorIdByLabel = new Map(
    world.nodes.filter((n) => n.node_type === "Sector").map((n) => [n.label, n.node_id])
  );
  institutions.forEach((inst) => {
    inst.sector_id = sectorIdByLabel.get(inst.sector) || null;
    if (!inst.sector_id) warnings.push(`sector label does not match any Sector node: ${inst.sector} (${inst.label})`);
  });

  const families = costs.sectorFamilies || {};
  institutions.forEach((inst) => {
    inst.family = inst.sector_id ? families[inst.sector_id] : undefined;
    if (inst.sector_id && !inst.family) warnings.push(`sector has no family in mobility-costs: ${inst.sector_id}`);
  });

  // ---- explicit org<->org edges (irreducible relations) --------------------
  const bonusPair = new Map(); // "i|j" -> multiplier (symmetric)
  if (opts.useExplicitEdges && costs.edgeBonuses) {
    for (const e of world.edges) {
      const mult = costs.edgeBonuses[e.edge_type];
      if (typeof mult !== "number") continue;
      const a = idx.get(e.source_id), b = idx.get(e.target_id);
      if (a == null || b == null) continue;   // e.g. Organisation -> Hub flow edges
      const k1 = a + "|" + b, k2 = b + "|" + a;
      bonusPair.set(k1, Math.max(bonusPair.get(k1) || 1, mult));
      bonusPair.set(k2, Math.max(bonusPair.get(k2) || 1, mult));
    }
  }

  // ---- affinity -----------------------------------------------------------
  const gt = costs.geoTiers, st = costs.sectorTiers;
  const gamma = (costs.gradient && typeof costs.gradient.gamma === "number") ? costs.gradient.gamma : 1.0;

  const adjacentSet = new Set();
  if (costs.blocAffinity && Array.isArray(costs.blocAffinity.adjacent)) {
    for (const [x, y] of costs.blocAffinity.adjacent) { adjacentSet.add(x + "|" + y); adjacentSet.add(y + "|" + x); }
  }

  function shareAny(a, b) { for (const v of a) if (b.indexOf(v) !== -1) return true; return false; }

  function geoTier(A, B) {
    if (shareAny(A.hubIds, B.hubIds)) return gt.sameCity;
    if (shareAny(A.countryIds, B.countryIds)) return gt.sameCountry;
    // Cross-country. Without bloc affinity every such move is one flat tier —
    // this is the ablation switch, not a fallback.
    if (!opts.useBlocAffinity) return gt.sameBloc;
    if (shareAny(A.blocs, B.blocs)) return gt.sameBloc;
    for (const x of A.blocs) for (const y of B.blocs) if (adjacentSet.has(x + "|" + y)) return gt.adjacentBloc;
    return gt.distantBloc;
  }

  function sectorTier(A, B) {
    if (A.subsector && A.subsector === B.subsector) return st.sameSubsector;
    if (A.sector === B.sector) return st.sameSector;
    if (A.family && A.family === B.family) return st.sameFamily;
    return st.differentFamily;
  }

  // The only asymmetric term: moving up the economic gradient is free, moving
  // down is penalised. gamma = 0 disables it.
  function gradient(A, B) {
    if (gamma === 0) return 1;
    if (A.marketIndex == null || B.marketIndex == null || A.marketIndex <= 0) return 1;
    const ratio = B.marketIndex / A.marketIndex;
    return Math.min(1, Math.pow(ratio, gamma));
  }

  function affinity(i, j) {
    if (i === j) return 1;
    const A = institutions[i], B = institutions[j];
    const bonus = bonusPair.get(i + "|" + j) || 1;
    const a = geoTier(A, B) * sectorTier(A, B) * gradient(A, B) * bonus;
    return Math.max(0, Math.min(1, a));
  }

  // ---- neighbours: the high-affinity set, for candidate generation ---------
  // The affinity model makes every institution reachable in principle, so
  // "neighbours" is no longer the reachable set — it is the CHEAP set, used to
  // keep per-tick candidate generation bounded. Anything above the threshold.
  const NEIGHBOR_THRESHOLD = 0.25;
  const neighbors = Array.from({ length: M }, () => new Set());
  for (let i = 0; i < M; i++) {
    for (let j = i + 1; j < M; j++) {
      // symmetric part only — the gradient term is directional but should not
      // decide who is structurally "near" whom
      const A = institutions[i], B = institutions[j];
      const symmetric = geoTier(A, B) * sectorTier(A, B) * (bonusPair.get(i + "|" + j) || 1);
      if (Math.min(1, symmetric) >= NEIGHBOR_THRESHOLD) { neighbors[i].add(j); neighbors[j].add(i); }
    }
  }

  const degree = new Uint32Array(M);
  for (let i = 0; i < M; i++) degree[i] = neighbors[i].size;
  const isolated = [];
  for (let i = 0; i < M; i++) if (degree[i] === 0) isolated.push(institutions[i].label);
  if (isolated.length) warnings.push(`${isolated.length} institution(s) have no near neighbours above affinity ${NEIGHBOR_THRESHOLD}`);

  // ---- precomputed destination sampler ------------------------------------
  // Row-major cumulative affinity: affinityCDF[i*M + j] is sum of affinity(i, 0..j),
  // with the diagonal zeroed (candidateInstitutions adds `current` itself, and a
  // self-weight of 1.0 would dominate every row).
  //
  // Replaces per-draw rejection sampling. Mean affinity is ~0.07, so accepting 25
  // distinct candidates by rejection cost ~350 affinity() calls — each doing
  // linear scans over hubIds/countryIds/blocs — which profiled at 75% of total
  // engine runtime. A binary search over this table is O(log M) instead.
  //
  // It is also strictly more correct: the rejection sampler silently topped up
  // uniformly whenever it exhausted its try budget, so low-affinity institutions
  // received a partly-uniform candidate set rather than an affinity-weighted one.
  // This samples exactly. World-model results therefore differ from those
  // produced before this change — see the samplerVersion in the fingerprint.
  //
  // Memory: M*M float64 = ~480KB at M=245. Built once per load (~8ms).
  const affinityCDF = new Float64Array(M * M);
  for (let i = 0; i < M; i++) {
    const base = i * M;
    let acc = 0;
    for (let j = 0; j < M; j++) {
      if (j !== i) acc += affinity(i, j);
      affinityCDF[base + j] = acc;
    }
  }

  // O(1) affinity lookup: consecutive CDF entries differ by exactly affinity(i,j),
  // so the table doubles as a memo. Used by the engine's mobility-friction term,
  // which would otherwise recompute affinity() (with its linear array scans) once
  // per candidate per moving agent.
  function affinityAt(i, j) {
    if (i === j) return 1;
    const base = i * M;
    return affinityCDF[base + j] - (j > 0 ? affinityCDF[base + j - 1] : 0);
  }

  // r must be in [0,1). Returns a destination drawn proportional to affinity from
  // i, or -1 if row i has no outgoing weight at all (impossible while affinity is
  // strictly positive, but guarded rather than assumed).
  function sampleDestination(i, r) {
    const base = i * M;
    const total = affinityCDF[base + M - 1];
    if (!(total > 0)) return -1;
    const target = r * total;
    let lo = 0, hi = M - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (affinityCDF[base + mid] <= target) lo = mid + 1; else hi = mid;
    }
    return lo === i ? -1 : lo;   // diagonal is flat, so lo can land on i only at a zero-width step
  }

  // ---- top-K destinations, precomputed --------------------------------------
  // Per institution, the TOP_K highest-affinity destinations in descending order.
  // Supports the top-K mobility heuristic: instead of evaluating every near
  // neighbour (mean 12.2, max 46), an agent considers only its best few options.
  // Precomputed once, so the runtime cost is a slice of a flat Int32Array.
  // Memory: M * TOP_K int32 = ~31KB at M=245, K=32.
  const TOP_K = 32;
  const topDestinations = new Int32Array(M * TOP_K);
  const topCount = new Int32Array(M);
  {
    const scratch = [];
    for (let i = 0; i < M; i++) {
      scratch.length = 0;
      for (let j = 0; j < M; j++) if (j !== i) scratch.push([j, affinityAt(i, j)]);
      scratch.sort((a, b) => b[1] - a[1]);
      const k = Math.min(TOP_K, scratch.length);
      for (let r = 0; r < k; r++) topDestinations[i * TOP_K + r] = scratch[r][0];
      topCount[i] = k;
    }
  }

  // ---- prestige -----------------------------------------------------------
  // Under BA, degree IS hub-ness so degree/maxDegree is a faithful centrality
  // measure. On an attribute-derived graph it is closer to "how big is the
  // clique I'm in", so the default sources prestige from the data instead.
  const prestige = new Float32Array(M);
  (function computePrestige() {
    let vals;
    if (opts.prestigeFrom === "degree") vals = Array.from(degree);
    else if (opts.prestigeFrom === "sizeBand") vals = institutions.map((x) => SIZE_BAND_RANK[x.sizeBand] || 0);
    else if (opts.prestigeFrom === "weightedDegree") {
      vals = institutions.map((_, i) => { let s = 0; for (const j of neighbors[i]) s += affinity(i, j); return s; });
    } else vals = institutions.map((x) => x.intake);
    let max = 0;
    for (const v of vals) if (v > max) max = v;
    for (let i = 0; i < M; i++) prestige[i] = max > 0 ? vals[i] / max : 0;
  })();

  // ---- entry weights (intake-proportional entrant placement) ---------------
  const entryWeights = new Float64Array(M);
  let totalIntake = 0;
  for (let i = 0; i < M; i++) { entryWeights[i] = institutions[i].intake; totalIntake += institutions[i].intake; }
  if (totalIntake <= 0) throw new Error("[world_model] total intake is zero — cannot build entry weights");

  // ---- provenance ---------------------------------------------------------
  const canon = [
    world.nodes.map((n) => n.node_id).sort().join(","),
    world.edges.map((e) => e.edge_id || (e.source_id + ">" + e.target_id + ":" + e.edge_type)).sort().join(","),
    JSON.stringify(costs.geoTiers), JSON.stringify(costs.sectorTiers),
    JSON.stringify(costs.sectorFamilies), JSON.stringify(costs.blocAffinity),
    JSON.stringify(costs.gradient), JSON.stringify(costs.edgeBonuses),
    JSON.stringify(opts),
    // Bumped when the sampling implementation changes in a way that alters
    // results, so CSVs from before and after are distinguishable.
    "sampler:v2-cdf",
  ].join("|");
  const fingerprint = fnv1a(canon);

  return {
    M, neighbors, degree, prestige,
    affinity, affinityAt, sampleDestination, affinityCDF,
    topDestinations, topCount, TOP_K,
    institutions, entryWeights, totalIntake,
    fingerprint, warnings, opts,
    isWorldModel: true,
  };
}

// Population size implied by the intake data and a career length, per
// world-model-plan.md section 4: headcount = annual intake x career years.
// N, turnoverRate and career length are one statement seen from three sides.
function suggestedN(wm, careerYears, divisor) {
  return Math.round((careerYears * wm.totalIntake) / (divisor || 1));
}

// Dual-mode export. Node gets CommonJS; the browser gets window.WorldModel, so
// simulator.html can <script src> this file rather than carrying a second copy
// of the loader that would drift from this one. simulator.html degrades to
// BA-only if the file isn't alongside it.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { loadWorldModel, suggestedN, fnv1a, DEFAULT_OPTS };
} else if (typeof globalThis !== "undefined") {
  globalThis.WorldModel = { loadWorldModel, suggestedN, fnv1a, DEFAULT_OPTS };
}

})();
