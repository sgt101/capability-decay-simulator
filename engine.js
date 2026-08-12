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

// HISTORICAL (removed 2026-08): a single signed dial `aiRelianceIntensity` (rho)
// used to drive both halves of de-skilling — aiDampeningBelow = 1 - rho and
// aiAtrophyMultiplier = 5^rho. It was removed because it named three parameters for
// two independent quantities, and because the base 5 was an untested exchange rate
// between the two channels: holding the learning half at rho = 0.5, varying that base
// from 2 to 8 moved meanE_shortfall from 0.213 to 0.346. The two multipliers are now
// always set directly. Don't reintroduce a coupling without measuring its base first.
//
// Old configs are rejected rather than ignored — see initSim().

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

// Chosen to sit roughly in the middle of the range where the self-renewal/collapse
// contrast reads cleanly (~0.3-0.86) — see expert_threshold_sensitivity.js and the
// "Expert threshold" section in README.md for the empirical check behind this choice.
// (Previously 0.7 — undocumented and close enough to the upper edge of that range
// that it inflated the AI-amplification-regime numbers via a baseline-ceiling
// artifact; 0.585 doesn't have that problem.)
const EXPERT_THRESHOLD = 0.585;

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
  // Lower bound on an entrant's draw. The draw is skew-normal clipped to [0,1],
  // so at entrantExpertiseMean = 0.05 with spread 0.05, ~16% of entrants used to
  // arrive at exactly E = 0 — and at a nominal mean of 0, fully half did. That
  // pile-up at the boundary made the bottom of the entrantExpertiseMean axis
  // non-linear in its own parameter (nominal 0 realised as 0.020), and it fed
  // the absorbing state at aiRelianceIntensity = 1 (problems.md P19).
  // Set to 0 for the pre-2026-08 behaviour.
  entrantExpertiseFloor: 0.05,
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
  // The AI's reference level, in absolute expertise units (aiLevel =
  // aiLevelFraction x startTopE, and startTopE is 1.0 for any realistic N — see
  // problems.md P17). Defaulted to EXPERT_THRESHOLD deliberately: the natural
  // reading of "the AI's level" is "as good as a human we would call expert",
  // and that is a stated quantity rather than a free choice. It also sits below
  // the saturation plateau that begins around 0.65, where lambda stops mattering
  // and aiDampeningAbove stops governing anybody (P16).
  aiLevelFraction: EXPERT_THRESHOLD, aiGain: 1.0,
  aiDampeningBelow: 0.30, aiDampeningAbove: 0.80,
  aiAtrophyMultiplier: 1.5,

  seed: 1,

  // --- world-model graph support (world-model-plan.md phases C/D) ----------
  // All default to today's behaviour, so an existing config is unaffected.
  graphSource: "ba",           // "ba" | "worldModel"
  worldModel: null,            // a loadWorldModel() result, NOT a path — keeps
                               // this file fs-free and browser-compatible
  institutionSizing: "uniform",// "uniform" | "weighted" (intake-proportional)
  // Mobility friction from the affinity model. Enters the move utility as
  // mobilityFriction * log(affinity), so under the softmax it multiplies a
  // candidate's weight by affinity^(mobilityFriction/MOVE_TEMPERATURE).
  // 0 reproduces the pre-world-model behaviour EXACTLY — asserted in test_engine.js.
  mobilityFriction: 0,
  // Top-K mobility heuristic. 0 = off (evaluate the full near-neighbour set, the
  // original behaviour). When > 0, an agent considers only its K highest-affinity
  // destinations instead of every neighbour — mobility is ~75% of runtime and its
  // cost is linear in the candidate count. World-model mode only; the BA graph has
  // no affinity ordering to take a top-K of.
  candidateCap: 0,
};

// Calibrated parameter set for the DECLARED time base: 1 tick = 1 month, career
// = 40 years = 480 ticks. DEFAULT_PARAMS above was tuned when the tick was
// dimensionless and does NOT survive that reading — at turnoverRate = 1/480 its
// transferRate = 0.5 drives 98% of the population above E = 0.95, saturating the
// no-AI baseline so the AI contrast has nothing to measure against.
//
// Kept as a separate overlay rather than folded into DEFAULT_PARAMS so the
// existing BA experiment set and its published results are untouched. Apply with
//   initSim(Object.assign({}, MONTHLY_TICK_PARAMS, yourParams))
//
// Derivation: calibrate_time_base.js and the "Time, turnover, and population
// scale" section of paper.md.
//
// Selected for a STATIONARY no-AI baseline, which is what makes meanE_shortfall
// interpretable — the shortfall is then "what AI removed", not "what AI removed
// plus wherever the baseline happened to have drifted to by the reporting tick".
// Measured at world-model scale (N=10,504, M=245), meanE over the 1440-tick
// horizon: 0.6291 -> 0.6294, a drift of +0.0002. Confirmed stationary long-run
// too (0.6589 at t=4800 vs 0.6586 at t=9600 for N=3000).
//
// The earlier pairing (0.13, 0.024) was NOT stationary: its equilibrium sits at
// ~0.56, below where the initial transient lands, so the baseline fell 0.5975 ->
// 0.5622 across the horizon (-0.035) and kept declining for another ten careers.
// Because sd(E) is only ~0.06, that slow drift dragged shareExpert from 0.80 to
// 0.05 — see problems.md P4/P7.
//
// Trade-off accepted: the higher baseline puts shareExpert at ~0.95, so that
// metric has little downward range left. meanE is the headline metric here.
const MONTHLY_TICK_PARAMS = {
  turnoverRate: 1 / 480,   // 0.002083 — 40-year career
  transferRate: 0.15,      // equilibrium meanE ~0.63 at world-model scale
  decayRate: 0.020,        // counterweight; sets where that equilibrium sits
};
const TICKS_PER_YEAR = 12;

const MOVE_TEMPERATURE = 0.12;
const UNCONSTRAINED_CANDIDATE_CAP = 25;

// Institution occupancy below this makes an institution's internal dynamics
// meaningless: learning runs on gap = Ebar[j] - E[i], and you are part of Ebar,
// so in a k-member institution the peer gap you feel is attenuated to (k-1)/k.
// At k=1 it is exactly zero. Reported per tick rather than enforced — the drain
// that asymmetric mobility produces is a real prediction, not an error, but a run
// where institutions fall below this should be treated as suspect.
const MIN_MEANINGFUL_OCCUPANCY = 5;

// Cumulative-weight sampling, shared by initial placement and turnover. This
// pairing is the whole point: placing entrants uniformly (as the engine used to)
// erases any intake-weighted distribution within ~50 ticks, so weighted sizing
// applied only at init is purely cosmetic. See world-model-plan.md D2.
function sampleInstitution(state, rng) {
  const cdf = state.institutionCDF;
  if (!cdf) return Math.floor(rng() * state.M);
  const r = rng() * cdf[cdf.length - 1];
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid; }
  return lo;
}

function initSim(userParams) {
  const params = Object.assign({}, DEFAULT_PARAMS, userParams || {});

  // Rejected, not ignored: initSim merges unknown keys straight into params and from
  // there into every CSV column, so a stale config would otherwise run DEFAULT
  // dampening while its results rows still advertised a reliance intensity.
  if (userParams && userParams.aiRelianceIntensity != null) {
    throw new Error(
      "[engine] aiRelianceIntensity was removed — set aiDampeningBelow and " +
      "aiAtrophyMultiplier directly (the old mapping was 1 - rho and 5^rho)");
  }

  const rng = mulberry32(params.seed >>> 0 || 1);

  let graph;
  if (params.graphSource === "worldModel") {
    const wm = params.worldModel;
    if (!wm || !wm.isWorldModel) {
      throw new Error("[engine] graphSource 'worldModel' requires params.worldModel to be a loadWorldModel() result");
    }
    // M is DERIVED from the data, not configured. Fail loudly rather than
    // silently ignoring whichever of the two the caller meant.
    if (userParams && userParams.M != null && userParams.M !== wm.M) {
      throw new Error(`[engine] M is derived from the world model (${wm.M}) — remove M from the config (got ${userParams.M})`);
    }
    params.M = wm.M;
    graph = wm;
  } else {
    graph = generateBAGraph(params.M, params.graphAttachment, rng);
  }

  const N = params.N;
  const E = new Float32Array(N);
  const C = new Float32Array(N);
  const L = new Float32Array(N);
  const inst = new Int32Array(N);

  // Built before placement so init and turnover draw from the same distribution.
  let institutionCDF = null;
  if (params.institutionSizing === "weighted") {
    const w = graph.entryWeights;
    if (!w) throw new Error("[engine] institutionSizing 'weighted' requires a world model supplying entryWeights");
    institutionCDF = new Float64Array(params.M);
    let acc = 0;
    for (let j = 0; j < params.M; j++) { acc += w[j]; institutionCDF[j] = acc; }
  }
  const placer = { M: params.M, institutionCDF };

  for (let i = 0; i < N; i++) {
    E[i] = sampleSkewNormalClipped(rng, params.expertiseMean, params.expertiseSpread, params.expertiseSkew);
    L[i] = sampleLognormal(rng, params.learningRateSpread);
    inst[i] = sampleInstitution(placer, rng);
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
    // Reusable mobility scratch (problems.md O1). Bounded by M+1: a candidate set
    // can never hold more than every institution plus the current one. ~2KB at
    // M=245. Allocated once per run, not once per moving agent per tick.
    scratchCand: new Int32Array(params.M + 1),
    scratchUtil: new Float64Array(params.M + 1),
    institutionCDF,
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

// Fills state.scratchCand with the candidate institution indices for this human
// and returns HOW MANY. Writing into a preallocated buffer rather than returning
// a fresh Set/Array removes ~3 allocations per moving agent; with ~560 movers per
// tick that was the single largest cost in the engine (problems.md O1).
//
// Dedupe is a linear scan rather than a Set: the candidate list is bounded by
// UNCONSTRAINED_CANDIDATE_CAP (25), and at that size a scan over a contiguous
// Int32Array beats hashing plus the allocation.
function fillCandidates(state, humanIdx, rng) {
  const mode = state.params.mobilityMode;
  const current = state.inst[humanIdx];
  const buf = state.scratchCand;
  let n = 0;
  const useFull = mode === "unconstrained" || (mode === "hybrid" && rng() < state.params.jumpProbability);

  if (useFull) {
    if (state.M <= UNCONSTRAINED_CANDIDATE_CAP) {
      for (let j = 0; j < state.M; j++) buf[n++] = j;
      return n;
    }
    buf[n++] = current;
    const sampleDest = state.graph.sampleDestination;
    if (sampleDest) {
      let draws = 0;
      const budget = UNCONSTRAINED_CANDIDATE_CAP * 8;
      while (n < UNCONSTRAINED_CANDIDATE_CAP && draws < budget) {
        draws++;
        const cand = sampleDest(current, rng());
        if (cand < 0) continue;
        let dup = false;
        for (let k = 0; k < n; k++) if (buf[k] === cand) { dup = true; break; }
        if (!dup) buf[n++] = cand;
      }
      return n;
    }
    while (n < UNCONSTRAINED_CANDIDATE_CAP) {
      const cand = Math.floor(rng() * state.M);
      let dup = false;
      for (let k = 0; k < n; k++) if (buf[k] === cand) { dup = true; break; }
      if (!dup) buf[n++] = cand;
    }
    return n;
  }

  const cap = state.params.candidateCap | 0;
  const top = state.graph.topDestinations;
  if (cap > 0 && top) {
    const K = state.graph.TOP_K;
    const c = Math.min(cap, state.graph.topCount[current]);
    for (let r = 0; r < c; r++) buf[n++] = top[current * K + r];
    buf[n++] = current;
    return n;
  }
  for (const j of state.graph.neighbors[current]) buf[n++] = j;
  buf[n++] = current;
  return n;
}

// Operates on preallocated buffers over [0, n). Overwrites `utils` with the
// softmax weights in place — the raw utilities aren't needed once maxU is known
// — so no weights array is allocated either. Arithmetic and summation order are
// unchanged from the array version, so results are bit-identical.
function softmaxPick(rng, ids, utils, n, temperature) {
  let maxU = -Infinity;
  for (let k = 0; k < n; k++) if (utils[k] > maxU) maxU = utils[k];
  let sum = 0;
  for (let k = 0; k < n; k++) { const e = Math.exp((utils[k] - maxU) / temperature); utils[k] = e; sum += e; }
  let r = rng() * sum;
  for (let k = 0; k < n; k++) {
    r -= utils[k];
    if (r <= 0) return ids[k];
  }
  return ids[n - 1];
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
    const from = inst[i];
    const cands = state.scratchCand, utils = state.scratchUtil;
    const nc = fillCandidates(state, i, rng);
    const useFriction = p.mobilityFriction !== 0 && !!graph.affinity;
    const affAt = graph.affinityAt || graph.affinity;
    for (let k = 0; k < nc; k++) {
      const j = cands[k];
      const growth = Math.max(0, Ebar[j] - E[i]);
      const status = E[i] - Ebar[j];
      let u = (1 - p.competitionAversion) * growth + p.competitionAversion * status + p.prestigeWeight * graph.prestige[j];
      // Mobility friction. affinity <= 1 so the log is <= 0 — always a penalty,
      // never a bonus. Under the softmax this scales the candidate's weight by
      // affinity^(mobilityFriction / MOVE_TEMPERATURE). At mobilityFriction = 0
      // the term vanishes and behaviour is bit-for-bit identical to before.
      if (useFriction && j !== from) {
        const a = affAt(from, j);
        u += p.mobilityFriction * Math.log(a > 1e-12 ? a : 1e-12);
      }
      utils[k] = u;
    }
    inst[i] = softmaxPick(rng, cands, utils, nc, MOVE_TEMPERATURE);
  }

  let removed = 0;
  for (let i = 0; i < N; i++) {
    if (rng() < p.turnoverRate) {
      const draw = sampleSkewNormalClipped(rng, p.entrantExpertiseMean, p.entrantExpertiseSpread, p.entrantExpertiseSkew);
      E[i] = draw < p.entrantExpertiseFloor ? p.entrantExpertiseFloor : draw;
      L[i] = sampleLognormal(rng, p.learningRateSpread);
      // Same sampler as initial placement — see sampleInstitution(). Placing
      // entrants uniformly here is what used to wash out any weighted sizing.
      inst[i] = sampleInstitution(state, rng);
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

  // Occupancy diagnostics. Asymmetric mobility drains low-market-index
  // institutions by design (that is the brain-drain prediction), but an
  // institution that falls below MIN_MEANINGFUL_OCCUPANCY has an Ebar that is
  // mostly noise, so its internal dynamics stop meaning anything. Recorded per
  // tick rather than enforced, so a run can be judged rather than silently
  // rejected. Counted AFTER mobility and turnover, so it reflects the state the
  // next tick will actually run on.
  const occ = new Int32Array(M);
  for (let i = 0; i < N; i++) occ[inst[i]]++;
  let minOcc = Infinity, emptyInst = 0, underOcc = 0;
  for (let j = 0; j < M; j++) {
    if (occ[j] < minOcc) minOcc = occ[j];
    if (occ[j] === 0) emptyInst++;
    if (occ[j] < MIN_MEANINGFUL_OCCUPANCY) underOcc++;
  }

  const entry = {
    t: state.t, meanE, meanC, gap: meanC - meanE,
    divergence: varEbar, topE, aiLevel,
    shareBelowAI: p.aiEnabled ? belowCount / N : null,
    shareExpert: expertCount / N,
    turnover: removed,
    minOccupancy: minOcc === Infinity ? 0 : minOcc,
    emptyInstitutions: emptyInst,
    underOccupiedInstitutions: underOcc,
  };
  state.history.push(entry);
  return entry;
}

const API = {
  mulberry32, randNormal, sampleSkewNormalClipped, sampleLognormal, clip01,
  generateBAGraph, AI_MODES, DEFAULT_PARAMS, EXPERT_THRESHOLD,
  MONTHLY_TICK_PARAMS, TICKS_PER_YEAR, MIN_MEANINGFUL_OCCUPANCY,
  initSim, institutionStats, tick, sampleInstitution,
};

// Dual-mode export, same pattern as world_model.js. Node gets CommonJS; the
// browser gets globalThis.Engine, so simulator.html <script src>es THIS file
// instead of carrying its own copy of the model. There was such a copy until
// 2026-08; nothing compared the two, so the interactive tool could silently
// simulate different dynamics from the ones the published results came from.
//
// No fallback if this file is missing: the page throws and renders nothing.
// A simulator that quietly runs a different model than the batch runs is worse
// than one that doesn't start.
if (typeof module !== "undefined" && module.exports) {
  module.exports = API;
} else if (typeof globalThis !== "undefined") {
  globalThis.Engine = API;
}
