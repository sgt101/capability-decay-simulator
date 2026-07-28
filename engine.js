// Capability Decay Simulator — engine (framework-agnostic, testable under Node)

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randNormal(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clip01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function sampleSkewNormalClipped(rng, mu, omega, alpha) {
  const x0 = randNormal(rng), x1 = randNormal(rng);
  const delta = alpha / Math.sqrt(1 + alpha * alpha);
  const u1 = delta * x0 + Math.sqrt(1 - delta * delta) * x1;
  const z = x0 >= 0 ? u1 : -u1;
  return clip01(mu + omega * z);
}

function sampleLognormal(rng, sigma) {
  return Math.exp(randNormal(rng) * sigma);
}

// --- Barabasi-Albert sparse graph over institutions ---
function generateBAGraph(M, mAttach, rng) {
  const m = Math.max(1, Math.min(mAttach, M - 1));
  const neighbors = Array.from({ length: M }, () => new Set());
  const degree = new Uint32Array(M);
  const m0 = m + 1;

  for (let a = 0; a < m0; a++) {
    for (let b = a + 1; b < m0; b++) {
      neighbors[a].add(b); neighbors[b].add(a);
      degree[a]++; degree[b]++;
    }
  }
  const repeated = [];
  for (let a = 0; a < m0; a++) for (let k = 0; k < degree[a]; k++) repeated.push(a);

  for (let i = m0; i < M; i++) {
    const targets = new Set();
    let tries = 0;
    while (targets.size < m && tries < 200) {
      tries++;
      const cand = repeated.length ? repeated[Math.floor(rng() * repeated.length)] : Math.floor(rng() * i);
      if (cand !== i && !targets.has(cand)) targets.add(cand);
    }
    while (targets.size < m) { // fallback for tiny graphs
      const cand = Math.floor(rng() * i);
      if (cand !== i) targets.add(cand);
    }
    targets.forEach((t) => {
      neighbors[i].add(t); neighbors[t].add(i);
      degree[i]++; degree[t]++;
      repeated.push(i, t);
    });
  }

  let maxDeg = 1;
  for (let i = 0; i < M; i++) if (degree[i] > maxDeg) maxDeg = degree[i];
  const prestige = new Float32Array(M);
  for (let i = 0; i < M; i++) prestige[i] = degree[i] / maxDeg;

  return { M, neighbors, degree, prestige };
}

// --- AI capability boost shapes: boost(E) at ai_level a ---
const AI_MODES = {
  floor: (e, a) => Math.max(0, a - e),
  flat: (e, a) => a,
  linear: (e, a) => a * e,
  amplified: (e, a) => a * e * e,
  exponential: (e, a) => e * (Math.exp(a * e) - 1),
};

const DEFAULT_PARAMS = {
  N: 500, M: 40,
  expertiseMean: 0.28, expertiseSpread: 0.30, expertiseSkew: 3,
  // New entrants (turnover replacements) start as genuine novices, distinct from the
  // t=0 population above (which represents an already-running, mixed-skill system).
  // This is what makes AI-driven decline compounding rather than a one-time step down
  // to a lower plateau: entrants only become expert via peer transfer, so if AI
  // dampens that transfer, they stay stuck near-zero — and as more of the population
  // is replaced by stuck entrants, institution averages fall further, so even
  // existing experts near them decay faster too (their own gap = Ebar - E gets more
  // negative). See spec.html "Entrant renewal" for the full mechanism.
  entrantExpertiseMean: 0.05, entrantExpertiseSpread: 0.05, entrantExpertiseSkew: 0,
  graphAttachment: 2,
  transferRate: 0.5, decayRate: 0.01, learningRateSpread: 0.4,
  // Humans at/above their institution's own average don't just decay — being
  // embedded among strong peers is itself a source of gradual improvement (osmosis,
  // harder problems, higher-caliber review), scaled by how strong the institution
  // is. Checked: this has to be anchored to the institution's FOUNDING average
  // (state.startEbar, fixed at init), not its live one — using the live average
  // creates a runaway positive feedback loop (top performers rise -> average rises
  // -> ambient growth rises further -> ...) that saturates the entire population to
  // E=1 by t~2000-5000 regardless of AI. The fixed anchor still saturates given a
  // long enough horizon (nothing here is a stable equilibrium, only a slow one), but
  // at this default it stays a gentle, non-dominant effect through the model's
  // standard 1000-tick horizon and doesn't meaningfully touch the AI/no-AI contrast
  // under worst-case dampening (see generate_experiments.js's aiDampeningBelow/Above
  // default) — checked directly against the self-renewal scenario.
  ambientGrowthRate: 0.001,
  mobilityMode: "hybrid", jumpProbability: 0.10,
  competitionAversion: 0.5, prestigeWeight: 0.3, baseMoveProb: 0.05,
  turnoverRate: 0.01,
  aiEnabled: false, aiResponseMode: "floor",
  aiLevelFraction: 0.70, aiGain: 1.0,
  aiDampeningBelow: 0.30, aiDampeningAbove: 0.80,
  aiAtrophyMultiplier: 1.5,
  seed: 1,
};

const MOVE_TEMPERATURE = 0.12;
const UNCONSTRAINED_CANDIDATE_CAP = 25;
// Chosen to sit roughly in the middle of the range where the self-renewal/collapse
// contrast reads cleanly (~0.3-0.86) — see expert_threshold_sensitivity.js and the
// "Expert threshold" section in README.md for the empirical check behind this choice.
// (Previously 0.7 — undocumented and close enough to the upper edge of that range
// that it inflated the AI-amplification-regime numbers via a baseline-ceiling
// artifact; 0.585 doesn't have that problem.)
const EXPERT_THRESHOLD = 0.585;

function initSim(userParams) {
  const params = Object.assign({}, DEFAULT_PARAMS, userParams || {});
  const rng = mulberry32(params.seed >>> 0 || 1);
  const graph = generateBAGraph(params.M, params.graphAttachment, rng);

  const N = params.N;
  const E = new Float32Array(N);
  const C = new Float32Array(N);
  const L = new Float32Array(N);
  const inst = new Int32Array(N);

  for (let i = 0; i < N; i++) {
    E[i] = sampleSkewNormalClipped(rng, params.expertiseMean, params.expertiseSpread, params.expertiseSkew);
    L[i] = sampleLognormal(rng, params.learningRateSpread);
    inst[i] = Math.floor(rng() * params.M);
    C[i] = E[i];
  }

  // Fixed for the whole run, set once from the t=0 population: "the greatest human
  // expert at the start of the simulation" — the single highest E, captured once at
  // init. ai_level is a fraction of THIS, not of the current/live top performer, so
  // it's a stable benchmark that doesn't chase the population's own trajectory as it
  // grows or collapses over the run (an earlier version recomputed this from the live
  // top performer every tick and had exactly that moving-target problem).
  let startTopE = 0;
  for (let i = 0; i < N; i++) if (E[i] > startTopE) startTopE = E[i];

  // Each institution's OWN founding average, fixed at init — the anchor for ambient
  // growth (see ambientGrowthRate above). Deliberately not recomputed per tick: an
  // institution's live average is itself moved by the very effect this anchors, so
  // using it directly would create unbounded positive feedback.
  const startEbar = new Float32Array(params.M);
  const startCount = new Int32Array(params.M);
  for (let i = 0; i < N; i++) { startEbar[inst[i]] += E[i]; startCount[inst[i]]++; }
  for (let j = 0; j < params.M; j++) startEbar[j] = startCount[j] > 0 ? startEbar[j] / startCount[j] : 0;

  return {
    params, rng, graph,
    N, M: params.M,
    E, C, L, inst,
    startTopE, startEbar,
    t: 0,
    history: [],
    snapshots: [],
    lastAiLevel: null,
  };
}

function institutionStats(state) {
  const { M, inst, E } = state;
  const sumE = new Float64Array(M);
  const count = new Int32Array(M);
  for (let i = 0; i < state.N; i++) { sumE[inst[i]] += E[i]; count[inst[i]]++; }
  const Ebar = new Float32Array(M);
  for (let j = 0; j < M; j++) Ebar[j] = count[j] > 0 ? sumE[j] / count[j] : 0;
  return { Ebar, count };
}

function candidateInstitutions(state, humanIdx, rng) {
  const mode = state.params.mobilityMode;
  const current = state.inst[humanIdx];
  const neighbors = state.graph.neighbors[current];
  const useFull = mode === "unconstrained" || (mode === "hybrid" && rng() < state.params.jumpProbability);

  if (useFull) {
    if (state.M <= UNCONSTRAINED_CANDIDATE_CAP) {
      const all = [];
      for (let j = 0; j < state.M; j++) all.push(j);
      return all;
    }
    const set = new Set([current]);
    while (set.size < UNCONSTRAINED_CANDIDATE_CAP) set.add(Math.floor(rng() * state.M));
    return Array.from(set);
  }
  const arr = Array.from(neighbors);
  arr.push(current);
  return arr;
}

function softmaxPick(rng, ids, utilities, temperature) {
  let maxU = -Infinity;
  for (const u of utilities) if (u > maxU) maxU = u;
  const weights = utilities.map((u) => Math.exp((u - maxU) / temperature));
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = rng() * sum;
  for (let k = 0; k < ids.length; k++) {
    r -= weights[k];
    if (r <= 0) return ids[k];
  }
  return ids[ids.length - 1];
}

function tick(state) {
  const p = state.params;
  const { N, M, E, C, L, inst, rng, graph } = state;
  const { Ebar, count } = institutionStats(state);

  let topE = 0;
  for (let i = 0; i < N; i++) if (E[i] > topE) topE = E[i];
  // aiLevel is a fraction of the fixed t=0 top performer (state.startTopE), not of the
  // live/current one — a stable benchmark, not a moving target. topE above is the
  // live current top performer, still tracked and reported as its own metric, just
  // no longer used to derive aiLevel.
  const aiLevel = p.aiEnabled ? p.aiLevelFraction * state.startTopE : null;
  state.lastAiLevel = aiLevel;

  const boostFn = AI_MODES[p.aiResponseMode] || AI_MODES.floor;

  for (let i = 0; i < N; i++) {
    const j = inst[i];
    const gap = Ebar[j] - E[i];
    const below = p.aiEnabled && E[i] < aiLevel;
    let delta;
    if (gap > 0) {
      // learning: peers are stronger than you. AI reliance crowds this out —
      // below the AI's level, dampen it; the growth you would have had, you don't.
      delta = p.transferRate * gap * L[i];
      if (p.aiEnabled) delta *= below ? p.aiDampeningBelow : p.aiDampeningAbove;
    } else {
      // decay: peers are weaker than you, or you're idle relative to them. This is
      // never dampened by AI — reliance on AI actively accelerates it instead, since
      // it's the "use it or lose it" half of de-skilling, not the "didn't get to learn" half.
      let decay = p.decayRate * gap * L[i];
      if (below) decay *= p.aiAtrophyMultiplier;
      // Countered by ambient growth: even at/above the local ceiling, people keep
      // learning from being embedded in a strong institution — not gap-closing (there's
      // no local gap left to close) but general osmosis, scaled by how strong the
      // institution was to begin with. Not AI-gated: unlike the learning branch above,
      // this isn't something AI reliance crowds out, so it applies identically in both
      // arms and only affects the SIZE of the shared floor both start from, not the
      // AI/no-AI contrast itself.
      const ambient = p.ambientGrowthRate * state.startEbar[j] * L[i] * (1 - E[i]);
      delta = decay + ambient;
    }
    const newE = clip01(E[i] + delta);
    E[i] = newE;
    C[i] = p.aiEnabled ? clip01(newE + p.aiGain * boostFn(newE, aiLevel)) : newE;
  }

  for (let i = 0; i < N; i++) {
    if (rng() >= p.baseMoveProb * L[i]) continue;
    const candidates = candidateInstitutions(state, i, rng);
    const utilities = candidates.map((j) => {
      const growth = Math.max(0, Ebar[j] - E[i]);
      const status = E[i] - Ebar[j];
      return (1 - p.competitionAversion) * growth + p.competitionAversion * status + p.prestigeWeight * graph.prestige[j];
    });
    inst[i] = softmaxPick(rng, candidates, utilities, MOVE_TEMPERATURE);
  }

  let removed = 0;
  for (let i = 0; i < N; i++) {
    if (rng() < p.turnoverRate) {
      E[i] = sampleSkewNormalClipped(rng, p.entrantExpertiseMean, p.entrantExpertiseSpread, p.entrantExpertiseSkew);
      L[i] = sampleLognormal(rng, p.learningRateSpread);
      inst[i] = Math.floor(rng() * M);
      C[i] = E[i];
      removed++;
    }
  }

  state.t++;

  let sumE = 0, sumC = 0, belowCount = 0, expertCount = 0;
  for (let i = 0; i < N; i++) {
    sumE += E[i]; sumC += C[i];
    if (p.aiEnabled && E[i] < aiLevel) belowCount++;
    if (E[i] >= EXPERT_THRESHOLD) expertCount++;
  }
  const meanE = sumE / N, meanC = sumC / N;

  let activeCount = 0, sumEbar = 0;
  for (let j = 0; j < M; j++) if (count[j] > 0) { activeCount++; sumEbar += Ebar[j]; }
  const meanEbar = activeCount ? sumEbar / activeCount : 0;
  let varEbar = 0;
  for (let j = 0; j < M; j++) if (count[j] > 0) varEbar += (Ebar[j] - meanEbar) ** 2;
  varEbar = activeCount ? varEbar / activeCount : 0;

  const entry = {
    t: state.t, meanE, meanC, gap: meanC - meanE,
    divergence: varEbar, topE, aiLevel,
    shareBelowAI: p.aiEnabled ? belowCount / N : null,
    shareExpert: expertCount / N,
    turnover: removed,
  };
  state.history.push(entry);
  return entry;
}

module.exports = {
  mulberry32, randNormal, sampleSkewNormalClipped, sampleLognormal,
  generateBAGraph, AI_MODES, DEFAULT_PARAMS, EXPERT_THRESHOLD,
  initSim, institutionStats, tick,
};
